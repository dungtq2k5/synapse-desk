import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from './coverage';
import { FAKE_STRIPE_URL } from '../system/fake-stripe';
import { markVerified } from './emailed';
import { WEB_URL } from './ingress';
import { api, clearThrottles, DEMO_PASSWORD, signIn } from './support';

/**
 * Billing end to end, through the fake Stripe the stack runs: Checkout and
 * the portal are its pages, and every grant arrives by its signed webhook, as
 * in production. Each journey founds its own organization, on Free.
 */

test.beforeEach(clearThrottles);

const run = Date.now();
let count = 0;

type Org = {
  name: string;
  domain: string;
  organizationId: string;
  admin: { email: string; session: APIRequestContext };
};

/** A founder on a domain of its own, verified; the organization is on Free. */
async function organization(name: string): Promise<Org> {
  const domain = `${name}-${run}-${++count}.example.test`;
  const email = `maya@${domain}`;
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName: 'Maya Chen',
  });
  await markVerified(email);
  await api(session, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
  await api(session, 'PATCH', '/organizations/current/settings', {
    allowedEmailDomains: [domain],
  });
  const { user } = await api<{ user: { organizationId: string } }>(
    session,
    'GET',
    '/users/me',
  );
  const { name: organizationName } = await api<{ name: string }>(
    session,
    'GET',
    '/organizations/current',
  );
  return {
    name: organizationName,
    domain,
    organizationId: user.organizationId,
    admin: { email, session },
  };
}

/** People who join by domain, so they hold seats. */
async function members(org: Org, how: number): Promise<string[]> {
  const emails: string[] = [];
  for (let i = 1; i <= how; i += 1) {
    const email = `member${i}@${org.domain}`;
    const session = await newRequest.newContext({ baseURL: WEB_URL });
    await api(session, 'POST', '/auth/register', {
      email,
      password: DEMO_PASSWORD,
      fullName: `Member ${i}`,
    });
    await markVerified(email);
    await session.dispose();
    emails.push(email);
  }
  return emails;
}

/** The subscription as Billing reads it. */
const subscription = (org: Org) =>
  api<{
    stripeSubscriptionId: string | null;
    priceId: string | null;
    cancelAtPeriodEnd: boolean;
    status: string;
  }>(org.admin.session, 'GET', '/billing/subscription');

/** Pays for a plan through the fake's Checkout, and waits for its event. */
async function subscribe(org: Org, priceId: string): Promise<void> {
  const { url } = await api<{ url: string }>(
    org.admin.session,
    'POST',
    '/billing/checkout-session',
    {
      priceId,
      successUrl: `${WEB_URL}/settings/billing?checkout=success`,
      cancelUrl: `${WEB_URL}/settings/billing?checkout=canceled`,
    },
  );
  const stripe = await newRequest.newContext();
  await stripe.get(`${url}/pay`, { maxRedirects: 0 });
  await stripe.dispose();
  await expect
    .poll(async () => (await subscription(org)).priceId, { timeout: 15_000 })
    .toBe(priceId);
}

/** Tells the fake how this organization's next plan change goes. */
async function fake(org: Org, action: string, body: unknown = {}) {
  const stripe = await newRequest.newContext();
  const answer = await stripe.post(
    `${FAKE_STRIPE_URL}/__fake/organizations/${org.organizationId}/${action}`,
    { data: body },
  );
  expect(answer.ok(), await answer.text()).toBe(true);
  await stripe.dispose();
}

async function asAdmin(page: Page, org: Org) {
  await signIn(page, org.admin.email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goto('/settings/billing');
  await expect(
    page.getByRole('heading', { name: 'Billing', level: 1 }),
  ).toBeVisible();
}

async function anotherBrowser(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  return page;
}

const card = (page: Page, name: string | RegExp) =>
  page
    .getByRole('list', { name: 'Plans' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, level: 3 }) });

test('a free organization buys a plan through Checkout: the wait, then the plan', async ({
  page,
}) => {
  const org = await organization('billing-buy');
  await asAdmin(page, org);
  await expect(page.getByText('No subscription')).toBeVisible();

  await card(page, 'Pro').getByRole('button', { name: 'Choose Pro' }).click();
  await page
    .getByRole('button', { name: 'Continue to Stripe (opens Stripe)' })
    .click();
  await expect(page).toHaveURL(new RegExp(`^${FAKE_STRIPE_URL}/checkout/`));
  await page.getByRole('button', { name: 'Pay' }).click();

  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(page.getByText('Welcome to Pro')).toBeVisible({
    timeout: 20_000,
  });
  const current = page.getByRole('region', { name: 'Current plan' });
  await expect(current).toContainText('Active');
  await expect(current).toContainText('25 seats');
  await expect(current).toContainText(/Renews on/);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});

test('too big for the plan: the card says so, and Checkout refuses with the items', async ({
  page,
}) => {
  const org = await organization('billing-too-big');
  await members(org, 5);
  await asAdmin(page, org);

  const starter = card(page, 'Starter');
  await expect(starter).toContainText('You have 6 people; Starter allows 5.');
  await expect(
    starter.getByRole('button', { name: 'Choose Starter' }),
  ).toHaveAttribute('aria-disabled', 'true');

  const refused = await org.admin.session.post(
    '/api/v1/billing/checkout-session',
    {
      data: {
        priceId: 'price_fake_starter_monthly',
        successUrl: `${WEB_URL}/settings/billing`,
        cancelUrl: `${WEB_URL}/settings/billing`,
      },
    },
  );
  expect(refused.status()).toBe(400);
  expect((await refused.json()).details).toEqual({
    overLimit: [{ dimension: 'SEATS', inUse: 6, allowed: 5 }],
  });
});

test('a paid organization can’t open Checkout again: it’s told to change plan', async () => {
  const org = await organization('billing-twice');
  await subscribe(org, 'price_fake_pro_monthly');

  const again = await org.admin.session.post(
    '/api/v1/billing/checkout-session',
    {
      data: {
        priceId: 'price_fake_enterprise_monthly',
        successUrl: `${WEB_URL}/settings/billing`,
        cancelUrl: `${WEB_URL}/settings/billing`,
      },
    },
  );
  expect(again.status()).toBe(400);
  expect((await again.json()).error).toMatch(/change your plan instead/);
});

test('upgrade, switch to yearly, then a downgrade over a limit refuses and names it', async ({
  page,
}) => {
  const org = await organization('billing-change');
  await members(org, 5);
  await subscribe(org, 'price_fake_pro_monthly');
  await asAdmin(page, org);

  await card(page, 'Enterprise')
    .getByRole('button', { name: 'Upgrade to Enterprise' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Upgrade to Enterprise' })
    .click();
  await expect(page.getByText('Confirming your new plan…')).toBeVisible();
  await expect(page.getByText('You’re on Enterprise')).toBeVisible({
    timeout: 20_000,
  });
  await expect(card(page, 'Enterprise, your current plan')).toBeVisible();

  // An interval-only switch moves no grant; its wait ends on the price.
  await page.getByRole('radio', { name: 'Yearly' }).click();
  await card(page, 'Enterprise, your current plan')
    .getByRole('button', { name: 'Switch to yearly' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Switch to yearly' })
    .click();
  await expect(page.getByText('You’re on Enterprise').last()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await subscription(org)).priceId)
    .toBe('price_fake_enterprise_yearly');
  await expect(page.getByText('Confirming your new plan…')).toHaveCount(0);

  // Six people; Starter allows five. Said in the card, and refused by the
  // server with the item, whichever way the change is asked for.
  await expect(card(page, 'Starter')).toContainText(
    'You have 6 people; Starter allows 5.',
  );
  const refused = await org.admin.session.post('/api/v1/billing/plan', {
    data: {
      planId: await planId(org, 'Starter'),
      priceId: 'price_fake_starter_yearly',
    },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).details).toEqual({
    overLimit: [{ dimension: 'SEATS', inUse: 6, allowed: 5 }],
  });
});

async function planId(org: Org, name: string): Promise<string> {
  const plans = await api<{ id: string; name: string }[]>(
    org.admin.session,
    'GET',
    '/billing/plans',
  );
  return plans.find((plan) => plan.name === name)!.id;
}

test('a declined card on a change: refused, and the organization stays as it was', async ({
  page,
}) => {
  const org = await organization('billing-declined');
  await subscribe(org, 'price_fake_pro_monthly');
  const before = await subscription(org);
  await fake(org, 'next-change', { outcome: 'declined' });
  await asAdmin(page, org);

  await card(page, 'Enterprise')
    .getByRole('button', { name: 'Upgrade to Enterprise' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Upgrade to Enterprise' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Your card was declined',
  );
  await expect(
    dialog.getByRole('button', {
      name: 'Manage billing on Stripe (opens Stripe)',
    }),
  ).toBeVisible();

  const after = await subscription(org);
  expect(after.priceId).toBe(before.priceId);
  expect(after.status).toBe(before.status);
});

test('cancel in the portal: back on the page, it ends on its date', async ({
  page,
}) => {
  const org = await organization('billing-cancel');
  await subscribe(org, 'price_fake_pro_monthly');
  await asAdmin(page, org);

  await page
    .getByRole('button', { name: 'Manage billing on Stripe (opens Stripe)' })
    .click();
  await expect(page).toHaveURL(new RegExp(`^${FAKE_STRIPE_URL}/portal/`));
  await page.getByRole('button', { name: 'Cancel plan' }).click();

  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(page.getByText('Canceled')).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(`^Ends on .+\\. After that, ${org.name} is frozen`),
    ),
  ).toBeVisible();
});

test('past due: the banner for an admin and a member, a write refused, billing still works', async ({
  page,
  browser,
}) => {
  const org = await organization('billing-past-due');
  const [member] = await members(org, 1);
  await subscribe(org, 'price_fake_pro_monthly');
  await fake(org, 'payment-failed');
  await expect
    .poll(async () => (await subscription(org)).status)
    .toBe('SUSPENDED_PAST_DUE');

  await asAdmin(page, org);
  const banner = page.getByRole('status', { name: 'Payment overdue' });
  await expect(banner).toContainText(
    `A payment failed. ${org.name} is read-only until it’s settled.`,
  );
  await expect(
    banner.getByRole('button', { name: 'Update payment (opens Stripe)' }),
  ).toBeVisible();
  // Billing still works, with the failed payment first.
  await expect(page.getByText('A payment failed').first()).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: /^Pay \$[\d.,]+ on Stripe \(opens in a new tab\)$/,
    }),
  ).toBeVisible();

  // A write is refused in the deck's words, said once.
  await page.goto('/settings/organization');
  const profile = page.getByRole('region', { name: 'Profile' });
  await profile.getByLabel('Name').fill(`${org.name} Renamed`);
  await profile.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(`${org.name} is read-only`)).toBeVisible();
  await expect(
    page.getByText(
      'A payment failed, so nothing can be created or changed until it’s settled. Update the payment in Billing.',
    ),
  ).toBeVisible();

  const other = await anotherBrowser(browser, member);
  await expect(
    other.getByRole('status', { name: 'Payment overdue' }),
  ).toContainText('Ask your admin to update the payment.');
  await other.context().close();
});

test('frozen: a signed-in member gets the frozen page; signing in again is refused', async ({
  page,
}) => {
  const org = await organization('billing-frozen');
  await subscribe(org, 'price_fake_pro_monthly');
  await asAdmin(page, org);

  await fake(org, 'ended');
  await expect
    .poll(async () => {
      const response = await org.admin.session.get('/api/v1/users/me');
      return (await response.json()).data.organizationStatus;
    })
    .toBe('FROZEN');

  await page.goto('/tickets');
  await expect(
    page.getByRole('heading', { name: /is frozen$/, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, org.admin.email, DEMO_PASSWORD);
  await expect(
    page.getByText('This organization can’t be opened'),
  ).toBeVisible();
  await expect(
    page.getByText('Contact support to restore access.'),
  ).toBeVisible();
});

test('a read-only viewer sees the plan and no actions', async ({ page }) => {
  const org = await organization('billing-viewer');
  const [viewer] = await members(org, 1);
  await subscribe(org, 'price_fake_pro_monthly');
  const role = await api<{ id: string }>(org.admin.session, 'POST', '/roles', {
    name: 'Billing viewer',
    permissionCodes: ['organization.read'],
  });
  const { items } = await api<{ items: { user: { id: string } }[] }>(
    org.admin.session,
    'GET',
    `/users?searchTerm=${encodeURIComponent(viewer)}`,
  );
  await api(org.admin.session, 'PUT', `/users/${items[0].user.id}/roles`, {
    roleIds: [role.id],
  });

  await signIn(page, viewer, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  await page.goto('/settings/billing');
  await expect(card(page, 'Pro, your current plan')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Upgrade|Change|Choose|Switch/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
  await expect(
    page.getByText(
      'Only people who can update the organization can change the plan or see invoices.',
    ),
  ).toBeVisible();
});

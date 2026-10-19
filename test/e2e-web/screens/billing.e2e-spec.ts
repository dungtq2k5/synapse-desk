import type { Route } from '@playwright/test';
import { expect, test, type Page } from '../coverage';
import {
  BILLING_USAGE,
  FREE,
  FREE_USAGE,
  INVOICES,
  PLANS,
  STORAGE,
  SUBSCRIPTION,
  invoice,
} from './billing-data';
import { DEMO_PASSWORD } from '../support';
import { look } from './look';
import { failed, hang, ok, settings, type Overrides } from './settings-data';
import {
  giveOnly,
  setOrganizationStatus,
  signInAs,
  tenant,
  type Person,
  type Tenant,
} from './tenant';

/**
 * Settings › Billing (design 09): every state of the matrix, each checked by
 * what it says, axe and a baseline. Billing's calls are answered here, so the
 * deck's plans and invoices are on every run; the viewer is real. Stripe is
 * never reached: leaving for it is answered with a held request.
 */

const PAGE = '/settings/billing';

const BILLING: Overrides = {
  'GET /billing/subscription': ok(SUBSCRIPTION),
  'GET /billing/plans': ok(PLANS),
  'GET /billing/invoices': ok(INVOICES),
  'GET /organizations/current/usage': ok(BILLING_USAGE),
  'GET /documents/storage': ok(STORAGE),
};

async function open(
  page: Page,
  overrides: Overrides = {},
  as?: (found: Tenant) => Person,
  path = PAGE,
) {
  const found = await tenant('billing');
  const person = as ? as(found) : found.maya;
  await signInAs(page, person);
  await settings(page, person.id, { ...BILLING, ...overrides });
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: 'Billing', level: 1 }),
  ).toBeVisible();
}

const plans = (page: Page) => page.getByRole('list', { name: 'Plans' });
const card = (page: Page, name: string | RegExp) =>
  plans(page)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name, level: 3 }),
    });

test.describe('the page', () => {
  test('Pro, paid monthly, for an Org Admin', async ({ page }) => {
    await open(page);
    await expect(page.getByText('Renews on 1 Nov 2026')).toBeVisible();
    await expect(card(page, 'Pro, your current plan')).toContainText(
      'Current plan',
    );
    await expect(page.getByText('8F3A21C7-0012').first()).toBeVisible();
    await look(page, 'billing');
  });

  test('Pro, paid yearly', async ({ page }) => {
    await open(page, {
      'GET /billing/subscription': ok({
        ...SUBSCRIPTION,
        priceId: 'price_pro_yearly',
        interval: 'year',
        currentPeriodEnd: '2027-10-01T00:00:00.000Z',
      }),
    });
    await expect(page.getByText('$990.00 per year')).toBeVisible();
    await look(page, 'billing-yearly');
  });

  test('a free organization: Choose on every plan, no portal, no invoices', async ({
    page,
  }) => {
    await open(page, {
      'GET /billing/subscription': ok(FREE),
      'GET /organizations/current/usage': ok(FREE_USAGE),
      'GET /documents/storage': ok({ ...STORAGE, documentCount: 40 }),
    });
    await expect(page.getByText('No subscription')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Choose Starter' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(
      0,
    );
    await look(page, 'billing-free');
  });

  test('a read-only viewer: the plans without buttons', async ({ page }) => {
    const found = await tenant('billing-viewer');
    await giveOnly(found.maya, found.priya, 'Billing viewer', [
      'organization.read',
    ]);
    await signInAs(page, found.priya);
    await settings(page, found.priya.id, BILLING);
    await page.goto(PAGE);
    await expect(
      page.getByText(
        'Only people who can update the organization can change the plan or see invoices.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Upgrade/ })).toHaveCount(0);
    await look(page, 'billing-read-only');
  });

  test('Stripe unreachable: the invoices say so; the rest stays', async ({
    page,
  }) => {
    await open(page, {
      'GET /billing/invoices': failed(503, 'Stripe isn’t responding!'),
    });
    await expect(
      page.getByText('Invoices can’t be loaded right now'),
    ).toBeVisible();
    await look(page, 'billing-invoices-unreachable');
  });

  test('loading', async ({ page }) => {
    const found = await tenant('billing');
    await signInAs(page, found.maya);
    await settings(page, found.maya.id, {
      ...BILLING,
      'GET /billing/subscription': hang,
    });
    await page.goto(PAGE);
    await expect(page.getByRole('status', { name: '' }).first()).toBeAttached();
    await expect(page.getByText('Loading billing')).toBeAttached();
    await look(page, 'billing-loading');
  });

  test('an error', async ({ page }) => {
    await open(page, {
      'GET /billing/subscription': failed(500, 'Internal server error!'),
    });
    await expect(page.getByText('Couldn’t load billing')).toBeVisible();
    await look(page, 'billing-error');
  });

  test('no access without organization.read', async ({ page }) => {
    const found = await tenant('billing');
    await signInAs(page, found.jordan);
    await settings(page, found.jordan.id, BILLING);
    await page.goto(PAGE);
    await expect(page.getByText('This page isn’t available')).toBeVisible();
    await look(page, 'billing-no-access');
  });
});

test.describe('changing plan', () => {
  const ask = async (page: Page, plan: string, button: string) => {
    await card(page, plan).getByRole('button', { name: button }).click();
    return page.getByRole('dialog');
  };

  test('upgrade: the confirmation', async ({ page }) => {
    await open(page);
    const dialog = await ask(page, 'Enterprise', 'Upgrade to Enterprise');
    await expect(dialog.getByRole('heading')).toHaveText(
      'Upgrade to Enterprise?',
    );
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await look(page, 'plan-upgrade');
  });

  test('a smaller plan: the confirmation', async ({ page }) => {
    await open(page, {
      'GET /billing/subscription': ok({
        ...SUBSCRIPTION,
        planName: 'Enterprise',
        priceId: 'price_enterprise_monthly',
      }),
      'GET /organizations/current/usage': ok({
        ...BILLING_USAGE,
        seats: { ...BILLING_USAGE.seats, limit: 200 },
      }),
    });
    const dialog = await ask(page, 'Pro', 'Change to Pro');
    await expect(
      dialog.getByText('Everything you use today fits Pro.'),
    ).toBeVisible();
    await look(page, 'plan-smaller');
  });

  test('switch to yearly: the confirmation', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Yearly' }).click();
    const dialog = await ask(
      page,
      'Pro, your current plan',
      'Switch to yearly',
    );
    await expect(
      dialog.getByText('What Pro includes stays the same.'),
    ).toBeVisible();
    // Its renewal is a year from today.
    await look(page, 'plan-interval', {
      mask: [dialog.getByText(/renews on/)],
    });
  });

  test('too small: said in the card before confirming', async ({ page }) => {
    await open(page);
    const starter = card(page, 'Starter');
    await expect(starter).toContainText('Too small for your usage now');
    await expect(starter).toContainText(
      'You have 18 people; Starter allows 5.',
    );
    await expect(starter).toContainText(
      'You have 1,240 documents; Starter allows 1,000.',
    );
    await expect(
      starter.getByRole('button', { name: 'Change to Starter' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await look(page, 'plan-doesnt-fit-card');
  });

  test('too small: refused by the server', async ({ page }) => {
    await open(page, {
      'GET /organizations/current/usage': ok({
        ...BILLING_USAGE,
        seats: { ...BILLING_USAGE.seats, used: 3 },
      }),
      'GET /documents/storage': ok({ ...STORAGE, documentCount: 3 }),
      'POST /billing/plan': failed(
        400,
        'This plan does not fit your current usage!',
        {
          overLimit: [
            { dimension: 'SEATS', inUse: 18, allowed: 5 },
            { dimension: 'DOCUMENTS', inUse: 1_240, allowed: 1_000 },
          ],
        },
      ),
    });
    const dialog = await ask(page, 'Starter', 'Change to Starter');
    await dialog.getByRole('button', { name: 'Change to Starter' }).click();
    const refused = page.getByRole('alertdialog');
    await expect(refused.getByRole('heading')).toHaveText(
      /Starter doesn’t fit/,
    );
    await expect(
      refused.getByRole('button', { name: 'Choose another plan' }),
    ).toBeFocused();
    await look(page, 'plan-doesnt-fit-server');
  });

  test('confirming, then the plan, with the done toast', async ({ page }) => {
    let paid = 'price_pro_monthly';
    await open(page, {
      'GET /billing/subscription': (route) =>
        route.fulfill(
          ok(
            paid === 'price_pro_monthly'
              ? SUBSCRIPTION
              : {
                  ...SUBSCRIPTION,
                  planName: 'Enterprise',
                  maxAgentSeats: 200,
                  priceId: paid,
                },
          ),
        ),
      'POST /billing/plan': (route) =>
        route.fulfill(
          ok({
            planId: 'plan-enterprise',
            planName: 'Enterprise',
            effectiveAt: '2026-10-19T00:00:00.000Z',
            creditIssued: false,
          }),
        ),
    });
    const dialog = await ask(page, 'Enterprise', 'Upgrade to Enterprise');
    await dialog.getByRole('button', { name: 'Upgrade to Enterprise' }).click();
    await expect(page.getByText('Confirming your new plan…')).toBeVisible();
    await expect(dialog).toBeHidden();
    await look(page, 'plan-confirming', {
      mask: [page.locator('.animate-spin')],
    });

    paid = 'price_enterprise_monthly';
    await expect(page.getByText('You’re on Enterprise')).toBeVisible();
    await look(page, 'plan-done', { viewportOnly: true });
  });

  test('confirming, past a minute', async ({ page }) => {
    await page.clock.install();
    await open(page, {
      'POST /billing/plan': ok({
        planId: 'plan-enterprise',
        planName: 'Enterprise',
        effectiveAt: '2026-10-19T00:00:00.000Z',
        creditIssued: null,
      }),
    });
    const dialog = await ask(page, 'Enterprise', 'Upgrade to Enterprise');
    await dialog.getByRole('button', { name: 'Upgrade to Enterprise' }).click();
    await expect(page.getByText('Confirming your new plan…')).toBeVisible();
    await expect(dialog).toBeHidden();
    await page.clock.fastForward('01:01');
    await expect(
      page.getByText('Still confirming your new plan'),
    ).toBeVisible();
    await look(page, 'plan-confirming-long');
  });

  const refusal = (name: string, reply: unknown, alert: string) =>
    test(`refused: ${name}`, async ({ page }) => {
      await open(page, {
        'POST /billing/plan': reply as Overrides[string],
        ...(name === 'negotiated'
          ? {
              'GET /billing/subscription': (() => {
                let reads = 0;
                return (route: Route) => {
                  reads += 1;
                  return route.fulfill(
                    ok({ ...SUBSCRIPTION, negotiated: reads > 1 }),
                  );
                };
              })(),
            }
          : {}),
      });
      const dialog = await ask(page, 'Enterprise', 'Upgrade to Enterprise');
      await dialog
        .getByRole('button', { name: 'Upgrade to Enterprise' })
        .click();
      await expect(dialog.getByRole('alert')).toContainText(alert);
      await look(page, `plan-refused-${name}`);
    });

  refusal(
    'negotiated',
    failed(400, 'This workspace is on a negotiated plan!'),
    'Your plan can’t be changed here',
  );
  refusal(
    'retired',
    failed(404, 'That plan is no longer available!'),
    'Enterprise is no longer offered',
  );
  refusal(
    'unreachable',
    failed(503, 'Stripe isn’t responding!'),
    'Stripe isn’t responding',
  );
  refusal(
    'declined',
    failed(402, 'Your card was declined!'),
    'Your card was declined',
  );
});

test.describe('the Stripe round trip', () => {
  const free: Overrides = {
    'GET /billing/subscription': ok(FREE),
    'GET /organizations/current/usage': ok(FREE_USAGE),
    'GET /documents/storage': ok({ ...STORAGE, documentCount: 40 }),
  };

  test('choose a plan: continue to Stripe', async ({ page }) => {
    await open(page, free);
    await card(page, 'Pro').getByRole('button', { name: 'Choose Pro' }).click();
    await expect(page.getByRole('dialog', { name: 'Start Pro' })).toBeVisible();
    await look(page, 'start');
  });

  test('choose a plan: opening Stripe', async ({ page }) => {
    await open(page, { ...free, 'POST /billing/checkout-session': hang });
    await card(page, 'Pro').getByRole('button', { name: 'Choose Pro' }).click();
    await page
      .getByRole('button', { name: 'Continue to Stripe (opens Stripe)' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Opening Stripe…' }),
    ).toBeDisabled();
    await look(page, 'start-opening', {
      mask: [page.locator('.animate-spin')],
    });
  });

  test('choose a plan: too small, said before', async ({ page }) => {
    await open(page, {
      ...free,
      'GET /organizations/current/usage': ok({
        ...FREE_USAGE,
        seats: { ...FREE_USAGE.seats, used: 8 },
      }),
    });
    await expect(card(page, 'Starter')).toContainText(
      'You have 8 people; Starter allows 5.',
    );
    await look(page, 'start-doesnt-fit-card');
  });

  test('choose a plan: refused by the server', async ({ page }) => {
    await open(page, {
      ...free,
      'POST /billing/checkout-session': failed(
        400,
        'This plan does not fit your current usage!',
        {
          overLimit: [{ dimension: 'SEATS', inUse: 8, allowed: 5 }],
        },
      ),
    });
    await card(page, 'Starter')
      .getByRole('button', { name: 'Choose Starter' })
      .click();
    await page
      .getByRole('button', { name: 'Continue to Stripe (opens Stripe)' })
      .click();
    await expect(page.getByRole('alertdialog')).toContainText(
      'You have 8 people; Starter allows 5. Remove 3, or choose another plan.',
    );
    await look(page, 'start-doesnt-fit-server');
  });

  test('back from Checkout: confirming, then confirmed', async ({ page }) => {
    let paid = false;
    await open(
      page,
      {
        'GET /billing/subscription': (route) =>
          route.fulfill(ok(paid ? SUBSCRIPTION : FREE)),
        'GET /organizations/current/usage': ok(FREE_USAGE),
        'GET /billing/invoices': ok([invoice(1, 10, 9_900)]),
      },
      undefined,
      `${PAGE}?checkout=success&plan=Pro`,
    );
    await expect(page.getByText('Confirming your subscription…')).toBeVisible();
    await expect(page).toHaveURL(PAGE);
    await look(page, 'back-confirming', {
      mask: [page.locator('.animate-spin')],
    });
    paid = true;
    await expect(page.getByText('Welcome to Pro')).toBeVisible();
    await look(page, 'back-confirmed', { viewportOnly: true });
  });

  test('back from Checkout: canceled', async ({ page }) => {
    await open(page, free, undefined, `${PAGE}?checkout=canceled`);
    await expect(page.getByText('Checkout canceled')).toBeVisible();
    await look(page, 'back-canceled');
  });

  test('manage billing: opening Stripe', async ({ page }) => {
    await open(page, { 'POST /billing/portal-session': hang });
    await page
      .getByRole('button', { name: 'Manage billing on Stripe (opens Stripe)' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Opening Stripe…' }),
    ).toBeDisabled();
    await look(page, 'portal-opening', {
      mask: [page.locator('.animate-spin')],
    });
  });

  test('back from the portal: canceled, ends on', async ({ page }) => {
    await open(page, {
      'GET /billing/subscription': ok({
        ...SUBSCRIPTION,
        cancelAtPeriodEnd: true,
      }),
    });
    await expect(page.getByText(/Ends on 1 Nov 2026/)).toBeVisible();
    await look(page, 'ends-on');
  });

  test('couldn’t open Stripe', async ({ page }) => {
    await open(page, {
      'POST /billing/portal-session': failed(503, 'Stripe isn’t responding!'),
    });
    await page
      .getByRole('button', { name: 'Manage billing on Stripe (opens Stripe)' })
      .click();
    await expect(page.getByText('Couldn’t open Stripe')).toBeVisible();
    await look(page, 'stripe-unreachable-toast', { viewportOnly: true });
  });
});

test.describe('past due and frozen', () => {
  test('past due: the banner, for an Org Admin, a Support Agent and an End User', async ({
    page,
  }) => {
    const found = await tenant('billing-past-due');
    await setOrganizationStatus(found.maya, 'SUSPENDED_PAST_DUE');
    for (const [who, person] of [
      ['admin', found.maya],
      ['agent', found.jordan],
      ['end-user', found.priya],
    ] as const) {
      await page.context().clearCookies();
      await signInAs(page, person);
      await page.goto(who === 'end-user' ? '/requests' : '/tickets');
      const banner = page.getByRole('status', { name: 'Payment overdue' });
      await expect(banner).toContainText('A payment failed.');
      if (who === 'admin') {
        await expect(
          banner.getByRole('button', { name: 'Update payment (opens Stripe)' }),
        ).toBeVisible();
      } else {
        await expect(banner).toContainText(
          'Ask your admin to update the payment.',
        );
      }
      await look(page, `past-due-banner-${who}`);
    }
  });

  test('past due: a refused change, in the deck’s words', async ({ page }) => {
    const found = await tenant('billing-past-due');
    await setOrganizationStatus(found.maya, 'SUSPENDED_PAST_DUE');
    await signInAs(page, found.jordan);
    await page.goto('/tickets');
    await expect(
      page.getByRole('status', { name: 'Payment overdue' }),
    ).toBeVisible();
    // What the browser fetcher raises for a refused write.
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('synapsedesk:organization-status', {
          detail: 'SUSPENDED_PAST_DUE',
        }),
      ),
    );
    await expect(page.getByText(/is read-only$/)).toBeVisible();
    await look(page, 'past-due-refused', { viewportOnly: true });
  });

  test('past due: Billing, the failed payment first', async ({ page }) => {
    const found = await tenant('billing-past-due');
    await setOrganizationStatus(found.maya, 'SUSPENDED_PAST_DUE');
    await signInAs(page, found.maya);
    await settings(page, found.maya.id, {
      ...BILLING,
      'GET /billing/subscription': ok({
        ...SUBSCRIPTION,
        status: 'SUSPENDED_PAST_DUE',
      }),
      'GET /billing/invoices': ok([
        invoice(12, 10, 9_900, 'open'),
        ...INVOICES.slice(1),
      ]),
    });
    await page.goto(PAGE);
    await expect(
      page.getByRole('link', {
        name: 'Pay $99.00 on Stripe (opens in a new tab)',
      }),
    ).toBeVisible();
    await look(page, 'billing-past-due');
  });

  test('frozen: the page in place of the app', async ({ page }) => {
    const found = await tenant('billing-frozen');
    await signInAs(page, found.maya);
    await setOrganizationStatus(found.maya, 'FROZEN');
    await page.goto('/tickets');
    await expect(
      page.getByRole('heading', { name: /is frozen$/, level: 1 }),
    ).toBeFocused();
    await expect(
      page.getByRole('link', { name: 'support@synapsedesk.com' }),
    ).toBeVisible();
    await look(page, 'frozen');
  });

  test('frozen: signing in is refused', async ({ page }) => {
    const found = await tenant('billing-frozen');
    await setOrganizationStatus(found.maya, 'FROZEN');
    await page.goto('/login');
    await page.getByLabel('Email').fill(found.maya.email);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByText('This organization can’t be opened'),
    ).toBeVisible();
    await look(page, 'frozen-sign-in');
  });
});

import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from './coverage';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuthPrisma } from '../../services/auth-service/src/generated/prisma/client';
import { invitationLink, markVerified } from './emailed';
import { WEB_URL } from './ingress';
import { databaseUrl } from './screens/tenant';
import { api, clearThrottles, DEMO_PASSWORD, signIn } from './support';

/**
 * Settings end to end: each journey founds its own organization through the
 * API (the databases outlive a run, and the demo seed's seat guarantee needs
 * it to hold no invitations), then works in the browser as its Org Admin.
 */
test.beforeEach(clearThrottles);

const run = Date.now();
let count = 0;

type Org = {
  domain: string;
  organizationId: string;
  admin: { id: string; email: string; session: APIRequestContext };
};

/** A founder on a domain of its own, verified. */
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
  const { user } = await api<{ user: { id: string; organizationId: string } }>(
    session,
    'GET',
    '/users/me',
  );
  return {
    domain,
    organizationId: user.organizationId,
    admin: { id: user.id, email, session },
  };
}

/** A member who joined by their domain, verified. */
async function member(org: Org, first: string, fullName: string) {
  const email = `${first}@${org.domain}`;
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName,
  });
  await markVerified(email);
  await api(session, 'POST', '/auth/logout', {}).catch(() => undefined);
  await session.dispose();
  const { items } = await api<{
    items: { user: { id: string; email: string } }[];
  }>(
    org.admin.session,
    'GET',
    `/users?searchTerm=${encodeURIComponent(email)}`,
  );
  return { id: items[0].user.id, email, fullName };
}

/** The organization's seat limit, as a plan change would set it. */
async function setSeats(organizationId: string, seats: number) {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { maxAgentSeats: seats },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function seatsInUse(org: Org): Promise<number> {
  const usage = await api<{ seats: { used: number } }>(
    org.admin.session,
    'GET',
    '/organizations/current/usage',
  );
  return usage.seats.used;
}

async function asAdmin(page: Page, org: Org) {
  await signIn(page, org.admin.email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
}

async function anotherBrowser(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, DEMO_PASSWORD);
  // A member lands on Ask, an admin on Tickets.
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  return page;
}

/** Signed out: the next page goes to sign-in. */
async function expectSignedOut(page: Page) {
  await page.goto('/tickets').catch(() => undefined);
  await expect(page).toHaveURL(/\/login/);
}

async function inviteFromPeople(page: Page, emails: string[]) {
  await page.goto('/settings/people');
  await page.getByRole('button', { name: 'Invite people' }).click();
  const field = page.getByLabel('Email addresses');
  await field.fill(emails.join(', '));
  await field.press('Enter');
  await page.getByRole('button', { name: 'Preview' }).click();
}

test('invite two, one already a member: the preview flags it, one is sent and accepted', async ({
  page,
  browser,
}) => {
  const org = await organization('invite');
  const sam = await member(org, 'sam', 'Sam Okafor');
  const omar = `omar@${org.domain}`;
  await asAdmin(page, org);
  await inviteFromPeople(page, [omar, sam.email]);

  const dialog = page.getByRole('dialog', { name: 'Check before sending' });
  await expect(dialog.getByText(sam.email)).toBeVisible();
  await expect(dialog.getByText(/Already has an account here/)).toBeVisible();
  await dialog.getByRole('button', { name: /^Send 1 invitation/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(await invitationLink(omar));
  await invitee.getByLabel('Full name').fill('Omar Haddad');
  await invitee
    .getByLabel('Password', { exact: true })
    .fill('Harbor-Lights-26');
  await invitee.getByRole('button', { name: /^Join/ }).click();
  await expect(invitee).toHaveURL(/\/(tickets|ask|verify-email)/);

  await page.goto('/settings/people');
  await expect(
    page.getByRole('link', { name: 'Omar Haddad' }).first(),
  ).toBeVisible();
});

test('no seats: inviting, accepting and restoring at the limit', async ({
  page,
  browser,
}) => {
  const org = await organization('seats');
  const priya = await member(org, 'priya', 'Priya Shah');
  const omar = `omar@${org.domain}`;

  // Accepting when the seats ran out in between.
  await api(org.admin.session, 'POST', '/users/invitations', {
    invitations: [{ email: omar }],
  });
  const link = await invitationLink(omar);
  await setSeats(org.organizationId, (await seatsInUse(org)) - 1);
  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(link);
  await invitee.getByLabel('Full name').fill('Omar Haddad');
  await invitee
    .getByLabel('Password', { exact: true })
    .fill('Harbor-Lights-26');
  await invitee.getByRole('button', { name: /^Join/ }).click();
  await expect(invitee.getByText(/no free seats right now/)).toBeVisible();
  await expect(invitee.getByRole('link', { name: /billing/i })).toHaveCount(0);

  // Inviting at the limit.
  await setSeats(org.organizationId, await seatsInUse(org));
  await asAdmin(page, org);
  await inviteFromPeople(page, [`lena@${org.domain}`]);
  await expect(page.getByText('Not enough seats')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await expect(
    page.getByRole('link', { name: 'Plans and billing' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Restoring at the limit: deleting Priya frees her seat, which then goes.
  await api(org.admin.session, 'DELETE', `/users/${priya.id}`);
  await setSeats(org.organizationId, await seatsInUse(org));
  await page.goto(`/settings/people/${priya.id}`);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(
    page.getByText('No free seat to restore Priya Shah'),
  ).toBeVisible();
});

test('lock with a reason signs them out live; unlocked, they sign in again', async ({
  page,
  browser,
}) => {
  const org = await organization('lock');
  const sam = await member(org, 'sam', 'Sam Okafor');
  const theirs = await anotherBrowser(browser, sam.email);

  await asAdmin(page, org);
  await page.goto(`/settings/people/${sam.id}`);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Lock Sam Okafor?' });
  await dialog.getByLabel(/Reason/).fill('Laptop reported stolen.');
  await dialog.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();

  await expectSignedOut(theirs);

  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(
    page.getByRole('button', { name: 'Lock', exact: true }),
  ).toBeVisible();
  await signIn(theirs, sam.email, DEMO_PASSWORD);
  await expect(theirs).toHaveURL(/\/(tickets|ask)$/);
});

test('the last admin can’t take away their own Org Admin role', async ({
  page,
}) => {
  const org = await organization('last');
  await asAdmin(page, org);
  await page.goto(`/settings/people/${org.admin.id}`);
  await page.getByRole('button', { name: 'Edit roles' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit roles' });
  await dialog.getByRole('button', { name: 'Remove Org Admin' }).click();
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Maya Chen is the last active Org Admin' }),
  ).toBeVisible();
});

test('a custom role: made from the catalog, given, effective, refused deletion while held', async ({
  page,
}) => {
  const org = await organization('role');
  const sam = await member(org, 'sam', 'Sam Okafor');
  await asAdmin(page, org);
  await page.goto('/settings/roles');
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Name').fill('Billing Lead');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(
    page.getByRole('heading', { name: 'Billing Lead', level: 1 }),
  ).toBeVisible();

  await page.getByRole('checkbox', { name: 'View the audit log' }).click();
  await page.getByRole('checkbox', { name: 'View analytics' }).click();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByText('2 of 44 permissions.')).toBeVisible();

  await page.getByRole('button', { name: 'Add people' }).click();
  const picker = page.getByRole('combobox', { name: 'People' });
  await picker.fill('Sam');
  await page.getByRole('option', { name: /Sam Okafor/ }).click();
  await page.getByRole('button', { name: 'Give to 1 person' }).click();
  await expect(page.getByRole('link', { name: 'Sam Okafor' })).toBeVisible();

  await page.goto(`/settings/people/${sam.id}`);
  await expect(page.getByText('View the audit log').first()).toBeVisible();

  await page.goBack();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Billing Lead is held by 1 person' }),
  ).toBeVisible();
});

test('a department with members can’t be deleted; emptied, it’s deleted and restored', async ({
  page,
}) => {
  const org = await organization('dept');
  const sam = await member(org, 'sam', 'Sam Okafor');
  const { id } = await api<{ id: string }>(
    org.admin.session,
    'POST',
    '/departments',
    {
      name: 'HR',
    },
  );
  await api(org.admin.session, 'POST', `/departments/${id}/members`, {
    userIds: [sam.id],
  });
  await asAdmin(page, org);
  await page.goto(`/settings/departments/${id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'HR still has 1 member' }),
  ).toBeVisible();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  await page
    .getByRole('button', { name: 'Remove Sam Okafor from HR' })
    .first()
    .click();
  await expect(page.getByText('0 members')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/settings\/departments$/);

  await page.getByLabel('Show deleted').click();
  await page.getByRole('button', { name: 'Restore HR' }).first().click();
  await expect(page.getByRole('link', { name: 'HR' }).first()).toBeVisible();
});

test('a webhook endpoint: the secret once, rotated, a failing test, deleted', async ({
  page,
}) => {
  const org = await organization('hook');
  await asAdmin(page, org);
  await page.goto('/settings/webhooks');
  await page.getByRole('button', { name: 'New endpoint' }).click();
  await page
    .getByLabel('URL')
    .fill('https://nothing-answers.example.test/hook');
  await page.getByRole('checkbox', { name: /Ticket assigned/ }).click();
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  const secret = page.getByRole('status', { name: 'Signing secret' });
  await expect(secret).toHaveText(/\S{16,}/);
  const first = await secret.textContent();
  await page.getByLabel('I’ve stored the secret somewhere safe').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/settings\/webhooks\/[\w-]+$/);
  await expect(page.getByText(first ?? 'never')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(first ?? 'never')).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rotate secret' }).click();
  await page.getByRole('button', { name: 'Rotate secret' }).click();
  await expect(page.getByText('New signing secret')).toBeVisible();
  await expect(secret).not.toHaveText(first ?? '');
  await page.getByLabel('I’ve stored the secret somewhere safe').click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Send test' }).first().click();
  await expect(page.getByText('Test failed')).toBeVisible({ timeout: 30_000 });

  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .last()
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/settings\/webhooks$/);
  await expect(page.getByText('No endpoints yet')).toBeVisible();
});

test('inbound email: on, still there after a reload, rotated, off', async ({
  page,
}) => {
  const org = await organization('inbound');
  await asAdmin(page, org);
  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Turn on' }).click();
  const address = page.getByRole('status', { name: 'Inbound email address' });
  await expect(address).toHaveText(/@/);
  const first = await address.textContent();
  await page.reload();
  await expect(address).toHaveText(first ?? '');

  await page.getByRole('button', { name: 'Rotate address' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Rotate address' })
    .click();
  await expect(address).not.toHaveText(first ?? '');

  await page.getByRole('button', { name: 'Turn off' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Turn off' })
    .click();
  await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
});

test('the audit log shows the journey’s own actions and exports a CSV', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const org = await organization('audit');
  await api(org.admin.session, 'POST', '/users/invitations', {
    invitations: [{ email: `omar@${org.domain}` }],
  });
  await api(org.admin.session, 'POST', '/webhook-endpoints', {
    url: 'https://nothing-answers.example.test/hook',
    eventTypes: ['ticket.assigned'],
  });
  await asAdmin(page, org);
  await page.goto('/settings/audit-log');
  await expect(
    page.getByRole('button', { name: 'Invited a person' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Created a webhook endpoint' }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Export/ }).click();
  await page.getByRole('button', { name: 'Request export' }).click();
  await expect(
    page.getByText(/Preparing your export|Your export is ready/),
  ).toBeVisible();
  await page.reload();
  const download = page.getByRole('button', { name: 'Download CSV' });
  await expect(download).toBeVisible({ timeout: 90_000 });
  const fetched = page
    .context()
    .waitForEvent('request', (request) =>
      /\/exports\/.+\.csv/.test(request.url()),
    );
  await download.click();
  const csv = await page.request.get((await fetched).url());
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('INVITATION_SENT');
});

test('a Support Agent sees People and Departments, read-only, and nothing else', async ({
  page,
}) => {
  const org = await organization('agent');
  const jordan = await member(org, 'jordan', 'Jordan Lee');
  const { items } = await api<{ items: { id: string; name: string }[] }>(
    org.admin.session,
    'GET',
    '/roles?limit=50&includeSystem=true',
  );
  const agent = items.find((role) => role.name === 'Support Agent (Tier 2)');
  await api(org.admin.session, 'PUT', `/users/${jordan.id}/roles`, {
    roleIds: [agent?.id],
  });
  await signIn(page, jordan.email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/people$/);
  const sections = page.getByRole('navigation', { name: 'Settings' });
  await expect(sections.getByRole('link')).toHaveText([
    'People',
    'Departments',
  ]);
  await expect(page.getByRole('button', { name: 'Invite people' })).toHaveCount(
    0,
  );
  await page.goto('/settings/roles');
  await expect(
    page.getByText(/can’t open|isn’t available/i).first(),
  ).toBeVisible();
});

test('deleting the organization signs everyone out, and sign-in says why', async ({
  page,
  browser,
}) => {
  const org = await organization('gone');
  const sam = await member(org, 'sam', 'Sam Okafor');
  const { name } = await api<{ name: string }>(
    org.admin.session,
    'GET',
    '/organizations/current',
  );
  const theirs = await anotherBrowser(browser, sam.email);
  await asAdmin(page, org);
  await page.goto('/settings/organization');
  await page.getByRole('button', { name: 'Delete organization' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Delete ${name}?` });
  await dialog
    .getByLabel('Why are you deleting it?')
    .fill('A journey’s throwaway.');
  await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
  await dialog.getByRole('button', { name: 'Delete organization' }).click();
  await expect(page).toHaveURL(/\/login\?organization-deleted=/);
  await expect(page.getByText(`${name} is being deleted`)).toBeVisible();

  await expectSignedOut(theirs);
  await signIn(theirs, sam.email, DEMO_PASSWORD);
  await expect(
    theirs.getByText('Your organization is closed for now'),
  ).toBeVisible();
});

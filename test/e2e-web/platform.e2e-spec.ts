import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuthPrisma } from '../../services/auth-service/src/generated/prisma/client';
import { FAKE_SPARE_PRICE } from '../system/fake-stripe';
import { expect, test, type Page } from './coverage';
import { resetLink } from './emailed';
import {
  databaseUrl,
  sessionAs,
  signInAs,
  tenant,
  type Tenant,
} from './screens/tenant';
import { superAdmin, type SuperAdmin } from './super-admin';
import { api, clearThrottles, DEMO_PASSWORD, signIn, totp } from './support';

/**
 * The platform console's journeys (design 11), against the real
 * stack: each makes its own Super Admin, with its own TOTP secret, so no two
 * rows share a 30-second code; organizations come from their own tenants.
 */

/** Signs in through the page as a person would: password, then the code. */
async function consoleSignIn(page: Page, admin: SuperAdmin): Promise<void> {
  await clearThrottles();
  await signIn(page, admin.email, DEMO_PASSWORD);
  await expect(
    page.getByRole('heading', { name: 'Two-step verification' }),
  ).toBeVisible();
  await page.getByLabel('Verification code').fill(totp(admin.secret!));
  await expect(page).toHaveURL(/\/platform$/);
}

/** The tenant's organization id, as its admin reads it. */
async function organizationOf(
  found: Tenant,
): Promise<{ id: string; name: string; slug: string }> {
  const session = await sessionAs(found.maya);
  try {
    return await api(session, 'GET', '/organizations/current');
  } finally {
    await session.dispose();
  }
}

test('a Super Admin without two-step sets it up, then lands on the console', async ({
  page,
}) => {
  const admin = await superAdmin('enrol', { twoStep: false });
  await clearThrottles();
  await signIn(page, admin.email, DEMO_PASSWORD);

  await expect(
    page.getByText(/^Super Admins must use a second step when they sign in\./),
  ).toBeVisible();
  await expect(page.locator('code')).toHaveText(/^[A-Z2-7 ]+$/);
  const key = (await page.locator('code').innerText()).trim();
  await page.getByLabel('Enter the 6-digit code from the app').fill(totp(key));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('I’ve saved my backup codes somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(
    page.getByRole('region', { name: 'Platform console' }),
  ).toBeVisible();
});

test('with two-step, a code is asked every time, and nothing remembers the device', async ({
  page,
}) => {
  const admin = await superAdmin('code');
  await clearThrottles();
  await signIn(page, admin.email, DEMO_PASSWORD);
  await expect(
    page.getByText('Super Admins enter a code every time they sign in.'),
  ).toBeVisible();
  await expect(page.getByLabel('Remember this device')).toHaveCount(0);
  await page.getByLabel('Verification code').fill(totp(admin.secret!));
  await expect(page).toHaveURL(/\/platform$/);
});

test('an Org Admin opening /platform finds it isn’t available', async ({
  page,
}) => {
  const found = await tenant('platform-org-admin');
  await signInAs(page, found.maya);
  await page.goto('/platform');
  await expect(
    page.getByRole('heading', { name: 'This page isn’t available' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Platform console' }),
  ).toHaveCount(0);
});

test('create an organization: the welcome link sets its admin’s password; a taken address is marked', async ({
  page,
}) => {
  const admin = await superAdmin('create');
  await consoleSignIn(page, admin);
  const slug = `welcome-${Date.now()}`;
  const email = `dana@${slug}.example.test`;

  await page.goto('/platform/organizations/new');
  await page.getByLabel('Name', { exact: true }).fill('Cedar Clinic');
  await page.getByLabel('Address').fill(slug);
  await page.getByLabel('Full name').fill('Dana Ortiz');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(
    page.getByText('We emailed Dana Ortiz a link to set a password.'),
  ).toBeVisible();

  // The same address again is refused under its field.
  await page.getByRole('button', { name: 'Create another' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Cedar Clinic again');
  await page.getByLabel('Address').fill(slug);
  await page.getByLabel('Full name').fill('Someone Else');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`someone@${slug}.example.test`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByLabel('Address')).toHaveAccessibleDescription(
    /That address is already taken by another organization\./,
  );

  // The welcome email's link sets the admin's password; they can sign in.
  await page.context().clearCookies();
  await page.goto(await resetLink(email));
  await page
    .getByLabel('New password', { exact: true })
    .fill('Welcome-Passw0rd!');
  await page.getByLabel('Confirm new password').fill('Welcome-Passw0rd!');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page).toHaveURL(/\/login\?reset/);
  await clearThrottles();
  await signIn(page, email, 'Welcome-Passw0rd!');
  await expect(page).not.toHaveURL(/\/login/);
});

test('freeze an organization with a reason, its member is signed out, then make it Active', async ({
  page,
  browser,
}) => {
  const found = await tenant('platform-freeze');
  const organization = await organizationOf(found);
  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await signInAs(memberPage, found.priya);

  const admin = await superAdmin('freeze', { fullName: 'Ana Ruiz' });
  await consoleSignIn(page, admin);
  await page.goto(`/platform/organizations/${organization.id}`);
  await page.getByRole('button', { name: 'Change status' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('Frozen').check();
  await dialog
    .getByLabel('Reason')
    .fill('Chargeback dispute opened with the bank.');
  await dialog
    .getByRole('button', { name: `Freeze ${organization.name}` })
    .click();
  await expect(
    page.getByText(/^\d+ sessions? were signed out\.$/),
  ).toBeVisible();
  await expect(page.getByText(/Frozen since \d+ \w+ 2026\./)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Platform actions on it' }),
  ).toContainText('Changed its status: Active → Frozen');
  await expect(
    page.getByRole('region', { name: 'Platform actions on it' }),
  ).toContainText('Ana Ruiz');

  // The member is signed out, and signing in says the organization is closed.
  await memberPage.goto('/tickets');
  await expect(memberPage).toHaveURL(/\/login/);
  await clearThrottles();
  await signIn(memberPage, found.priya.email, DEMO_PASSWORD);
  await expect(
    memberPage.getByText('This organization can’t be opened'),
  ).toBeVisible();
  await member.close();

  await page.getByRole('button', { name: 'Change status' }).click();
  await dialog.getByLabel('Reason').fill('Dispute resolved.');
  await dialog
    .getByRole('button', { name: `Make ${organization.name} Active` })
    .click();
  await expect(page.getByRole('region', { name: 'Status' })).toContainText(
    'Everything works for its people.',
  );
});

test('offboard and restore an organization: its address and domain are still its own', async ({
  page,
}) => {
  const found = await tenant('platform-offboard');
  const organization = await organizationOf(found);
  const admin = await superAdmin('offboard');
  await consoleSignIn(page, admin);
  await page.goto(`/platform/organizations/${organization.id}`);

  await page.getByRole('button', { name: 'Offboard', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('Reason').fill('Contract ended.');
  await dialog
    .getByLabel(`Type ${organization.name} to confirm`)
    .fill(organization.name);
  await dialog
    .getByRole('button', { name: `Offboard ${organization.name}` })
    .click();
  await expect(
    page.getByText(`${organization.name} was offboarded on`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('By Ravi Patel: “Contract ended.”', { exact: false }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Restore' }).first().click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: `Restore ${organization.name}` })
    .click();
  await expect(page.getByRole('region', { name: 'Status' })).not.toContainText(
    'Offboarded',
  );
  await expect(page.getByRole('region', { name: 'Profile' })).toContainText(
    organization.slug,
  );
});

test('create a negotiated plan, assign it, apply an edit, release: each preview names who’d be over a limit', async ({
  page,
}) => {
  const found = await tenant('platform-apply');
  const organization = await organizationOf(found);
  const admin = await superAdmin('plans');
  await freeSparePrice();
  await offAnyPlan(organization.id);
  await consoleSignIn(page, admin);

  await page.goto('/platform/plans/new');
  const name = `Team ${Date.now()}`;
  await page.getByLabel('Name').fill(name);
  for (const [label, value] of [
    ['Seats', '1'],
    ['Document storage (GB)', '5'],
    ['AI allowance a month (USD)', '5'],
    ['Largest document (MB)', '10'],
    ['Largest attachment (MB)', '5'],
    ['Documents', '1000'],
    ['Analytics ranges up to (days)', '90'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel('AI model').click();
  await page.getByRole('option', { name: 'Fast' }).click();
  await page.getByRole('button', { name: 'Add a price' }).click();
  await page.getByLabel('Stripe price 1').fill(FAKE_SPARE_PRICE.id);
  await page.getByRole('button', { name: 'Create plan' }).click();

  // The amount comes from Stripe once it's saved.
  await expect(page.getByRole('cell', { name: '$49.00' })).toBeVisible();
  const planId = page.url().split('/').pop()!;

  // Assigned from the organization's page: one seat is fewer than it uses.
  await page.goto(`/platform/organizations/${organization.id}`);
  await page.getByRole('button', { name: 'Assign a plan' }).click();
  const assign = page.getByRole('alertdialog');
  await assign.getByRole('combobox', { name: 'Plan' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(
    assign.getByText(`${organization.name} will be over a limit after this`),
  ).toBeVisible();
  await assign.getByLabel('Reason').fill('Signed a negotiated agreement.');
  await assign.getByRole('button', { name: `Assign ${name}` }).click();
  const limits = page.getByRole('region', { name: 'Plan and limits' });
  await expect(limits).toContainText(`${name} (assigned)`);

  // The plan edited and applied: the preview names it, and its limits follow.
  await page.goto(`/platform/plans/${planId}`);
  await page.getByLabel('Document storage (GB)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`${name} is saved`)).toBeVisible();
  await page.getByRole('link', { name: 'Preview applying' }).click();
  await expect(page.getByText('Nothing has changed yet')).toBeVisible();
  await expect(page.getByText(/will be over a limit after this/)).toBeVisible();
  await expect(
    page.getByText(`${organization.name} (seats)`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('table').getByText(/^Seats: \d+ in use, the plan grants 1$/),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Apply ${name} to 1 organization` })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: `Apply ${name} to 1 organization` })
    .click();
  await expect(page.getByText(/is applied$/)).toBeVisible();
  await page.goto(`/platform/organizations/${organization.id}`);
  await expect(
    limits.locator('dt:text-is("Document storage") + dd'),
  ).toHaveText('6 GB');

  // Released to self-service: the free tier, and Assign is offered again.
  await page.getByRole('button', { name: 'Release to self-service' }).click();
  const release = page.getByRole('alertdialog');
  await expect(release.getByText('What changes')).toBeVisible();
  await release.getByLabel('Reason').fill('The agreement ended.');
  await release
    .getByRole('button', { name: `Release ${organization.name}` })
    .click();
  await expect(limits).toContainText('Free');
  await expect(
    page.getByRole('button', { name: 'Assign a plan' }),
  ).toBeVisible();
});

/**
 * The spare price, back from whichever plan an earlier run gave it to: a
 * price belongs to one plan, and Postgres outlives a run.
 */
async function freeSparePrice(): Promise<void> {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    await prisma.subscriptionPlanPrice.deleteMany({
      where: { stripePriceId: FAKE_SPARE_PRICE.id },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The organization back on no plan, whichever an earlier run left it on: a
 * failed run doesn't reach its release.
 */
async function offAnyPlan(organizationId: string): Promise<void> {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { planId: null },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** How long a job run or backfill may take: two minutes. */
const RUN_WAIT_MS = 120_000;

test('run a job and backfill a range, each with a reason: both are in the audit log', async ({
  page,
}) => {
  test.setTimeout(2 * RUN_WAIT_MS + 60_000);
  const admin = await superAdmin('jobs', { fullName: 'Ana Ruiz' });
  await consoleSignIn(page, admin);
  await page.goto('/platform/jobs');

  await page
    .getByRole('button', { name: 'Run now: Analytics rollup, daily' })
    .click();
  let dialog = page.getByRole('alertdialog');
  await dialog
    .getByLabel('Reason')
    .fill('Checking the rollup after an import.');
  await dialog.getByRole('button', { name: 'Run now' }).click();
  // A real rollup over every organization in the database, which grows with
  // each run: it gets the gateway's run deadline, not the default wait.
  await expect(page.getByText('Analytics rollup, daily ran')).toBeVisible({
    timeout: RUN_WAIT_MS,
  });

  await page
    .getByRole('button', { name: 'Backfill: Analytics rollup, daily' })
    .click();
  dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('From').fill('2026-10-01');
  await dialog.getByLabel('To').fill('2026-10-03');
  await dialog
    .getByLabel('Reason')
    .fill('An import arrived after the daily run.');
  await dialog.getByRole('button', { name: 'Backfill' }).click();
  await expect(page.getByText('Backfill complete')).toBeVisible({
    timeout: RUN_WAIT_MS,
  });

  await page.goto('/platform/audit-log');
  const ran = page.getByRole('row').filter({ hasText: 'Ran a job' }).first();
  await expect(ran).toContainText('Ana Ruiz');
  await expect(ran).toContainText(/Job · [\d,]+ organizations?, [\d,]+ rows?/);
  await expect(ran).toContainText('Checking the rollup after an import.');
  const backfilled = page
    .getByRole('row')
    .filter({ hasText: 'Recomputed a job’s range' })
    .first();
  await expect(backfilled).toContainText('Ana Ruiz');
  await expect(backfilled).toContainText('1 Oct 2026 – 3 Oct 2026');
  await expect(backfilled).toContainText(
    'An import arrived after the daily run.',
  );
});

test('find a person across organizations and open their organization', async ({
  page,
}) => {
  const found = await tenant('platform-people');
  const organization = await organizationOf(found);
  const admin = await superAdmin('people');
  await consoleSignIn(page, admin);
  await page.goto('/platform/people');
  await page.getByLabel('Search by name or email').fill(found.priya.email);
  const row = page.getByRole('row').filter({ hasText: found.priya.email });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: organization.name }).click();
  await expect(
    page.getByRole('heading', { name: organization.name, level: 1 }),
  ).toBeVisible();
});

import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';
import { join } from 'node:path';
import { REPO_ROOT } from '../system/services';
import { emailCode, invitationLink, markVerified, resetLink } from './emailed';
import { emulatorIdToken } from './firebase';
import { WEB_URL } from './ingress';
import { api, clearThrottles, DEMO_PASSWORD, signIn, totp } from './support';

/**
 * A person's own account, end to end: joining, signing in, the profile's
 * security and the founder's setup. Each run's people and organizations are
 * its own, because the databases outlive a run. What an email would carry
 * comes from emailed.ts.
 */
test.beforeEach(clearThrottles);

const run = Date.now();
let count = 0;
/** An address on a domain of its own: registering with it founds an organization. */
const founderEmail = (name: string) =>
  `${name}@${name}-${run}-${++count}.example.test`;

/** Registers a founder through the API, their email already verified. */
async function founder(email: string, fullName = 'Robin Vale') {
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName,
  });
  await markVerified(email);
  await api(session, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
  return session;
}

/** Signs a set-up session out: it would count as one of the person's devices. */
async function leave(session: APIRequestContext) {
  await api(session, 'POST', '/auth/logout', {});
  await session.dispose();
}

/** A second browser, signed in as the same person: another device. */
async function anotherDevice(
  browser: Browser,
  email: string,
  password: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/tickets$/);
  return page;
}

/**
 * Signed out at once: the gateway refuses the revoked session's still-unexpired
 * access token, refreshing fails, and the next page sends this browser to
 * sign in.
 */
async function expectSignedOut(page: Page) {
  // It may already be on its way there: its socket was closed, its next call
  // refused, and that navigation aborts this one.
  await page.goto('/tickets').catch(() => undefined);
  await expect(page).toHaveURL(/\/login/);
}

test('sign up, then sign in, verify the email, and land in the app', async ({
  page,
}) => {
  const email = founderEmail('ada');
  const password = 'Harbor-Lights-26';

  await page.goto('/sign-up');
  await page.getByLabel('Full name').fill('Ada Brooks');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your email, then sign in' }),
  ).toBeVisible();

  await signIn(page, email, password);
  await expect(
    page.getByRole('heading', { name: 'Verify your email' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Verify', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Verification code').fill(await emailCode(email));

  await expect(
    page.getByRole('heading', { name: 'Email verified' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/tickets$/);
});

test('accepting an invitation signs in, into the inviting organization', async ({
  page,
}) => {
  const domain = `harbor-${run}.example.test`;
  const session = await founder(`robin@${domain}`);
  await api(session, 'PATCH', '/organizations/current', {
    name: 'Harbor Labs',
  });
  const invitee = `kai@elsewhere-${run}.example.test`;
  await api(session, 'POST', '/users/invitations', {
    invitations: [{ email: invitee }],
  });
  await leave(session);

  await page.goto(await invitationLink(invitee));
  await expect(
    page.getByRole('heading', { name: 'Join Harbor Labs' }),
  ).toBeVisible();
  await page.getByLabel('Full name').fill('Kai Moreno');
  await page.getByLabel('Password', { exact: true }).fill('Harbor-Lights-26');
  await page.getByRole('button', { name: 'Join Harbor Labs' }).click();

  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText('Harbor Labs').first()).toBeVisible();
});

test('changing the password signs the other device out', async ({
  page,
  browser,
}) => {
  const email = founderEmail('noor');
  await leave(await founder(email));
  const other = await anotherDevice(browser, email, DEMO_PASSWORD);

  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goto('/security');
  await page.getByLabel('Current password').fill(DEMO_PASSWORD);
  await page
    .getByLabel('New password', { exact: true })
    .fill('Harbor-Lights-26');
  await page.getByLabel('Confirm new password').fill('Harbor-Lights-26');
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(
    page.getByText('You were signed out on 1 other device.'),
  ).toBeVisible();
  await expectSignedOut(other);
  // This device stays signed in.
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/tickets$/);
});

/** The next step's code: the step just used can't be used twice. */
async function freshTotp(page: Page, key: string): Promise<string> {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000);
  return totp(key);
}

test('two-step on from Security, then off', async ({ page }) => {
  const email = founderEmail('lena');
  await leave(await founder(email));
  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goto('/security');

  await page.getByRole('button', { name: 'Turn on' }).click();
  const setup = page.getByRole('dialog');
  await expect(setup.locator('code')).toHaveText(/^[A-Z2-7 ]+$/);
  const key = (await setup.locator('code').innerText()).trim();
  await setup.getByLabel('Enter the 6-digit code from the app').fill(totp(key));
  await setup.getByRole('button', { name: 'Verify and continue' }).click();
  await setup.getByLabel('I’ve saved my backup codes somewhere safe').check();
  await setup.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Turn off' })).toBeEnabled();
  await page.getByRole('button', { name: 'Turn off' }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await confirm
    .getByLabel('Code from your app')
    .fill(await freshTotp(page, key));
  await confirm.getByRole('button', { name: 'Turn off' }).click();

  await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
});

test('signing another session out, then everywhere', async ({
  page,
  browser,
}) => {
  const email = founderEmail('omar');
  await leave(await founder(email));
  const other = await anotherDevice(browser, email, DEMO_PASSWORD);
  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goto('/security');

  await page.getByRole('button', { name: /^Sign out of / }).click();
  await expect(page.getByText(/^Signed out of /)).toBeVisible();
  await expectSignedOut(other);

  const third = await anotherDevice(browser, email, DEMO_PASSWORD);
  await page.reload();
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Sign out everywhere' })
    .click();

  await expect(page).toHaveURL(/\/login\?signed-out-everywhere=\d+$/);
  await expect(page.getByText('You’ve signed out everywhere')).toBeVisible();
  await expectSignedOut(page);
  await expectSignedOut(third);
});

test('a Google-only account sets a password through the link, then signs in with it', async ({
  page,
}) => {
  const email = `sam@google-only-${run}.example.test`;
  const idToken = await emulatorIdToken(email, 'Sam Rivera');
  const answer = await page.request.post('/api/v1/auth/google', {
    data: { idToken, deviceName: 'Chrome on Linux' },
  });
  expect(answer.ok(), await answer.text()).toBe(true);

  await page.goto('/security');
  await expect(page.getByText('You sign in with Google')).toBeVisible();
  await page.getByRole('button', { name: 'Set a password' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  await page.goto(await resetLink(email));
  await page
    .getByLabel('New password', { exact: true })
    .fill('Harbor-Lights-26');
  await page.getByLabel('Confirm new password').fill('Harbor-Lights-26');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page).toHaveURL(/\/login\?reset/);

  await signIn(page, email, 'Harbor-Lights-26');
  await expect(page).toHaveURL(/\/tickets$/);
});

test('a profile photo uploads through the real flow, and shows', async ({
  page,
}) => {
  // The presign, the bytes from the browser to Storage (the emulator, with
  // the method the presign names) and the confirm: nothing written around it.
  const email = founderEmail('ines');
  await leave(await founder(email));
  await signIn(page, email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goto('/profile');

  await page
    .locator('input[type="file"]')
    .setInputFiles(join(REPO_ROOT, 'test/fixtures/images/avatar.png'));

  await expect(
    page.getByRole('button', { name: 'Change photo' }),
  ).toBeVisible();
  // Read back from Storage: the avatar shows the stored object.
  await expect(page.locator('main img[src*="/avatars/"]')).toBeVisible();
});

test('a founder finishes setup', async ({ page }) => {
  const domain = `finish-${run}.example.test`;
  const email = `mira@${domain}`;
  const session = await founder(email);
  await api(session, 'POST', '/departments', { name: 'Support' });
  await api(session, 'PATCH', '/organizations/current/settings', {
    allowedEmailDomains: [domain],
  });
  await leave(session);
  // A colleague on the domain joins: the organization has a second member.
  const colleague = await newRequest.newContext({ baseURL: WEB_URL });
  await api(colleague, 'POST', '/auth/register', {
    email: `theo@${domain}`,
    password: DEMO_PASSWORD,
    fullName: 'Theo Park',
  });
  await colleague.dispose();

  await signIn(page, email, DEMO_PASSWORD);
  await expect(page.getByText('3 of 3 steps done')).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByText('Setup complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish setup' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeHidden();
});

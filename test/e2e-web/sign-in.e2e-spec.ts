import { expect, request as newRequest, test } from '@playwright/test';
import { WEB_URL } from './ingress';
import {
  api,
  clearThrottles,
  DEMO_PASSWORD,
  seededActors,
  signIn,
  totp,
} from './support';

test.beforeEach(clearThrottles);

test('a password sign-in lands on the ticket list', async ({ page }) => {
  const { admin } = await seededActors();

  await signIn(page, admin.email, DEMO_PASSWORD);

  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^#\d+/ }).first()).toBeVisible();
});

test('a wrong password says so, without saying which field', async ({
  page,
}) => {
  const { admin } = await seededActors();

  await signIn(page, admin.email, 'not-the-password');

  await expect(page.getByText('Email or password is incorrect')).toBeVisible();
  await expect(page.getByText('Check both and try again.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

/**
 * A new person founding a new organization, on a domain no other organization
 * allows: registration makes them its admin. Each run's domains are its own,
 * because the databases outlive a run and a domain an organization already
 * allows would make the registration join it instead.
 */
async function founder(email: string) {
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName: 'Robin Vale',
  });
  await api(session, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
  return session;
}

const run = Date.now();
const domain = (name: string) => `${name}-${run}.example.test`;

test('one email in two organizations: choose one', async ({ page }) => {
  // Robin founds the first organization; it stops admitting Robin's domain,
  // the second admits it, and Robin's second registration joins the second.
  const email = `robin@${domain('first')}`;
  const first = await founder(email);
  await api(first, 'PATCH', '/organizations/current/settings', {
    allowedEmailDomains: [domain('first-closed')],
  });
  await first.dispose();
  const secondEmail = `sam@${domain('second')}`;
  const second = await founder(secondEmail);
  await api(second, 'PATCH', '/organizations/current/settings', {
    allowedEmailDomains: [domain('second'), domain('first')],
  });
  await second.dispose();
  const joining = await newRequest.newContext({ baseURL: WEB_URL });
  await api(joining, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName: 'Robin Vale',
  });
  await joining.dispose();

  await signIn(page, email, DEMO_PASSWORD);

  await expect(
    page.getByRole('heading', { name: 'Choose an organization' }),
  ).toBeVisible();
  await expect(
    page.getByText(`${email} belongs to more than one`),
  ).toBeVisible();
  await page
    .getByRole('button', { name: new RegExp(`Workspace for ${secondEmail}`) })
    .click();

  await expect(page).toHaveURL(/\/tickets$/);
});

test('an organization that requires two-step: set it up, then the code', async ({
  page,
}) => {
  const email = `robin@${domain('two-step')}`;
  const session = await founder(email);
  await api(session, 'PATCH', '/organizations/current/settings', {
    enforceTwoFactor: true,
  });
  await session.dispose();

  await signIn(page, email, DEMO_PASSWORD);

  await expect(
    page.getByRole('heading', { name: 'Set up two-step verification' }),
  ).toBeVisible();
  const key = (await page.locator('code').innerText()).trim();
  expect(key).toMatch(/^[A-Z2-7 ]+$/);
  await page.getByLabel('Verification code').fill(totp(key));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Save your backup codes' }),
  ).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('I’ve saved my backup codes somewhere safe').check();
  await continueButton.click();

  await expect(
    page.getByRole('heading', { name: 'Two-step verification' }),
  ).toBeVisible();
  await expect(page.getByText('Two-step verification is on')).toBeVisible();
  await page.getByLabel('Verification code').fill(totp(key));

  await expect(page).toHaveURL(/\/tickets$/);
});

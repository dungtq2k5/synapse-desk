import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { REPO_ROOT } from '../../system/services';
import { look, tabsThrough } from './look';
import {
  givePhoto,
  setEmailVerified,
  setPhone,
  signInAs,
  tenant,
  type Person,
} from './tenant';

/**
 * The signed-in account screens, in every state, light and dark, at both
 * widths, drawn from the screen tenant (tenant.ts).
 */

test('the shell asks an unverified person to verify their email', async ({
  page,
}) => {
  const { priya } = await tenant('banner');
  await setEmailVerified([priya], false);
  await signInAs(page, priya);
  await page.goto('/tickets');
  await expect(
    page.getByRole('region', { name: 'Email verification' }),
  ).toBeVisible();
  await look(page, 'shell-verify-banner');
});

const API = '**/api/v1';
const PHOTO = join(REPO_ROOT, 'test/fixtures/images/avatar.png');
const NOW = new Date('2026-10-14T09:00:00Z');

/** The gateway's envelope, as `page.route` answers it. */
function answer(
  route: Route,
  status: number,
  data: unknown,
  retryAfter?: number,
): Promise<void> {
  const ok = status < 400;
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: retryAfter ? { 'retry-after': String(retryAfter) } : {},
    body: JSON.stringify(
      ok
        ? { success: true, statusCode: status, message: 'OK', data }
        : { success: false, statusCode: status, error: data },
    ),
  });
}

async function reply(
  page: Page,
  method: string,
  path: string,
  status: number,
  data: unknown = null,
  retryAfter?: number,
): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    route.request().method() === method
      ? answer(route, status, data, retryAfter)
      : route.fallback(),
  );
}

async function hold(page: Page, method: string, path: string): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    route.request().method() === method ? undefined : route.fallback(),
  );
}

/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

async function openProfile(page: Page, person: Person) {
  await signInAs(page, person);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
}

test.describe('profile', () => {
  test('default: the photo, the verified email and no phone', async ({
    page,
  }) => {
    const { maya } = await tenant('profile-photo');
    await givePhoto(maya);
    await openProfile(page, maya);
    await expect(
      page.getByRole('button', { name: 'Change photo' }),
    ).toBeVisible();
    await look(page, 'profile');
  });

  test('initials, an unverified email and a verified phone', async ({
    page,
  }) => {
    const { maya } = await tenant('profile-unverified');
    await setEmailVerified([maya], false);
    await setPhone(maya, '+15550100199');
    await openProfile(page, maya);
    await expect(page.getByText('Not verified', { exact: true })).toBeVisible();
    await look(page, 'profile-unverified');
  });

  test('its focus order', async ({ page }) => {
    const { maya } = await tenant('profile');
    await openProfile(page, maya);
    await page.getByRole('button', { name: 'Upload photo' }).focus();
    await tabsThrough(page, [
      /^Full name$/,
      /^Email$/,
      /^Add phone number$/,
      /^Date of birth$/,
      /^Gender$/,
    ]);
  });

  test('uploading a photo: a preview at once, and the progress', async ({
    page,
  }) => {
    const { maya } = await tenant('profile');
    await openProfile(page, maya);
    // The upload itself, held: it goes straight to storage, not the gateway.
    await page.route(/:9199\//, () => undefined);
    await page.locator('input[type=file]').setInputFiles(PHOTO);
    await expect(page.getByText(/Uploading photo… \d+%/)).toBeVisible();
    await look(page, 'profile-uploading');
  });

  test('a photo that couldn’t be uploaded', async ({ page }) => {
    const { maya } = await tenant('profile');
    await reply(
      page,
      'POST',
      '/users/me/avatar/upload-url',
      500,
      'Internal server error!',
    );
    await openProfile(page, maya);
    await page.locator('input[type=file]').setInputFiles(PHOTO);
    await expect(alert(page)).toContainText('Couldn’t upload your photo');
    await look(page, 'profile-upload-failed');
  });

  test('a photo over 2 MB is refused before uploading', async ({ page }) => {
    const { maya } = await tenant('profile');
    await openProfile(page, maya);
    await page.locator('input[type=file]').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(alert(page)).toContainText('That photo is too large');
    await look(page, 'profile-photo-too-large');
  });

  test('saving', async ({ page }) => {
    const { maya } = await tenant('profile');
    await hold(page, 'PATCH', '/users/me');
    await openProfile(page, maya);
    await page.getByLabel('Full name').fill('Maya L. Chen');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saving…')).toBeVisible();
    await look(page, 'profile-saving');
  });

  test('saved', async ({ page }) => {
    const { maya } = await tenant('profile-save');
    await openProfile(page, maya);
    await page.getByLabel('Date of birth').fill('03/14/1990');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await look(page, 'profile-saved', { viewportOnly: true });
  });

  test('saving failed: the changes are still there', async ({ page }) => {
    const { maya } = await tenant('profile');
    await reply(page, 'PATCH', '/users/me', 500, 'Internal server error!');
    await openProfile(page, maya);
    await page.getByLabel('Full name').fill('Maya L. Chen');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(alert(page)).toContainText('Couldn’t save your profile');
    await look(page, 'profile-save-failed');
  });

  test('leaving with unsaved changes asks first', async ({ page }) => {
    const { maya } = await tenant('profile');
    await openProfile(page, maya);
    await page.getByLabel('Full name').fill('Maya L. Chen');
    await page
      .getByRole('link', { name: 'Tickets', exact: true })
      .first()
      .click();
    await expect(
      page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Keep editing' }),
    ).toBeFocused();
    await look(page, 'profile-leaving', { widths: ['desktop'] });
  });
});

test.describe('phone number', () => {
  const SENT = { target: '+1******0199', expiresInMinutes: 10, codeLength: 6 };
  const REQUEST = '/auth/phone/verify/request';
  const VERIFY = '/auth/phone/verify';

  async function addNumber(page: Page) {
    const { maya } = await tenant('profile');
    await page.clock.setFixedTime(NOW);
    await openProfile(page, maya);
    await page.getByRole('button', { name: 'Add phone number' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  async function sendCode(page: Page) {
    await dialog(page).getByLabel('Phone number').fill('+1 555 010 0199');
    await page.getByRole('button', { name: 'Send code' }).click();
  }

  const dialog = (page: Page) => page.getByRole('dialog');
  const code = (page: Page) => page.getByLabel('Verification code');

  test('add a number', async ({ page }) => {
    await addNumber(page);
    await look(page, 'phone-add');
  });

  test('sending the code', async ({ page }) => {
    await hold(page, 'POST', REQUEST);
    await addNumber(page);
    await sendCode(page);
    await expect(dialog(page).getByText('Sending…')).toBeVisible();
    await look(page, 'phone-sending');
  });

  test('sent: a minute before it can be resent', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await addNumber(page);
    await sendCode(page);
    await expect(dialog(page).getByText('Resend code in 1:00')).toBeVisible();
    await look(page, 'phone-sent');
  });

  test('too many code requests', async ({ page }) => {
    let requests = 0;
    await page.route(`${API}${REQUEST}`, (route) =>
      ++requests === 1
        ? answer(route, 202, SENT)
        : answer(route, 429, 'Too many requests', 480),
    );
    await page.clock.install({ time: NOW });
    const { maya } = await tenant('profile');
    await openProfile(page, maya);
    await page.getByRole('button', { name: 'Add phone number' }).click();
    await sendCode(page);
    await expect(dialog(page).getByText('Resend code in 1:00')).toBeVisible();
    await page.clock.fastForward('01:01');
    await dialog(page).getByRole('button', { name: 'Resend code' }).click();
    await expect(
      dialog(page).getByText('Too many code requests'),
    ).toBeVisible();
    // The countdown frozen where it is: timers run, the time doesn't.
    await page.clock.setFixedTime(new Date(NOW.getTime() + 62_000));
    await look(page, 'phone-too-many-requests');
  });

  test('verifying', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await hold(page, 'POST', VERIFY);
    await addNumber(page);
    await sendCode(page);
    await code(page).fill('481920');
    await expect(
      dialog(page).getByRole('button', { name: 'Verifying…' }),
    ).toBeDisabled();
    await look(page, 'phone-verifying');
  });

  test('a wrong code', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await reply(page, 'POST', VERIFY, 200, {
      verified: false,
      attemptsRemaining: 3,
      mustRequestNewCode: false,
    });
    await addNumber(page);
    await sendCode(page);
    await code(page).fill('481920');
    await expect(dialog(page).getByRole('alert')).toContainText(
      'That code is wrong. You have 3 attempts left.',
    );
    await look(page, 'phone-wrong');
  });

  test('too many incorrect attempts', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await reply(
      page,
      'POST',
      VERIFY,
      429,
      'Too many incorrect attempts. Request a new code.',
    );
    await addNumber(page);
    await sendCode(page);
    await code(page).fill('481920');
    await expect(
      dialog(page).getByRole('button', { name: 'Request a new code' }),
    ).toBeFocused();
    await look(page, 'phone-out-of-attempts');
  });

  test('the code expired', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await reply(page, 'POST', VERIFY, 400, 'No verification code is pending.');
    await addNumber(page);
    await sendCode(page);
    await code(page).fill('481920');
    await expect(dialog(page).getByRole('alert')).toContainText(
      'That code has expired. Send yourself a new one.',
    );
    await look(page, 'phone-expired');
  });

  test('verified: a toast, and the dialog closes', async ({ page }) => {
    await reply(page, 'POST', REQUEST, 202, SENT);
    await reply(page, 'POST', VERIFY, 200, {
      verified: true,
      attemptsRemaining: 4,
      mustRequestNewCode: false,
    });
    await addNumber(page);
    await sendCode(page);
    await code(page).fill('481920');
    await expect(page.getByText('Phone number verified')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await look(page, 'phone-verified', { viewportOnly: true });
  });

  test('changing the number keeps the current one until the new one verifies', async ({
    page,
  }) => {
    const { maya } = await tenant('profile-change-phone');
    await setPhone(maya, '+15550100199');
    await openProfile(page, maya);
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(
      dialog(page).getByText(
        'Your current number stays until the new one is verified.',
      ),
    ).toBeVisible();
    await look(page, 'phone-change');
  });
});

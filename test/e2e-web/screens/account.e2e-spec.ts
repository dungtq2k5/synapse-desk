import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { REPO_ROOT } from '../../system/services';
import { look, tabsThrough } from './look';
import {
  givePhoto,
  setEmailVerified,
  setAccount,
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
    // The minute skipped below is past socket.io's ping timeout too, and a
    // dropped connection says so in a toast. This row needs no live updates,
    // so the socket never connects, and has nothing to drop.
    await page.route('**/socket.io/**', (route) => route.abort());
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
    // The countdown frozen where it is: timers run, the time doesn't. At the
    // page's own time, which the clicks above moved on by a varying amount.
    await page.clock.setFixedTime(await page.evaluate(() => Date.now()));
    await expect(dialog(page).getByText('Resend code in 8:00')).toBeVisible();
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

const STRONG = 'Northwind-2026';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SESSIONS = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    deviceName: null,
    ipAddress: '203.0.113.24',
    userAgent: MAC,
    current: true,
    isTrusted: true,
    trustedUntil: '2026-11-12T12:00:00Z',
    expiresAt: '2026-11-12T12:00:00Z',
    createdAt: '2026-10-13T09:12:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    deviceName: 'Maya’s iPhone',
    ipAddress: '198.51.100.7',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    current: false,
    isTrusted: true,
    trustedUntil: '2026-11-02T12:00:00Z',
    expiresAt: '2026-11-02T12:00:00Z',
    createdAt: '2026-10-03T19:40:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000a3',
    deviceName: null,
    ipAddress: '192.0.2.44',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    current: false,
    isTrusted: false,
    trustedUntil: null,
    expiresAt: '2026-10-18T12:00:00Z',
    createdAt: '2026-10-11T14:05:00Z',
  },
];
const SECRET = {
  otpauthUri:
    'otpauth://totp/SynapseDesk:maya%40northwind.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SynapseDesk',
  // A blank 1×1 PNG: the QR's place, without a picture that varies.
  qrCodeDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
};
const BACKUP_CODES = [
  'V8KQ2-MX7PL',
  'J8KPD-4WZNC',
  'N3TRW-6HDBA',
  'L5XRA-3JGVM',
  'Q9ZEX-2KCMR',
  'D6NQW-9TBEK',
  'F4WNJ-8RLTY',
  'G3ZYK-5PDRF',
  'B2VMC-7QHXP',
  'Y7MFH-2XQAL',
];

test.describe('security', () => {
  /**
   * The security page for Maya: two-step on and optional unless said, with
   * her backup codes and three sessions, all as the frames draw them. Her
   * account is set after signing in. The gateway keeps the organization for a
   * minute, so the row that has it require two-step uses its own tenant.
   */
  async function openSecurity(
    page: Page,
    { twoStep = true, required = false, hasPassword = true } = {},
  ) {
    const { maya } = await tenant(required ? 'security-required' : 'security');
    await reply(page, 'GET', '/auth/2fa/backup-codes', 200, {
      remaining: 7,
      used: 3,
      expiresAt: '2027-10-12T12:00:00Z',
    });
    await reply(page, 'GET', '/auth/sessions', 200, SESSIONS);
    await setAccount(maya);
    await signInAs(page, maya);
    await setAccount(maya, { twoStep, password: hasPassword, required });
    await page.goto('/security');
    await expect(
      page.getByRole('heading', { name: 'Security', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Chrome on macOS')).toBeVisible();
  }

  const dialog = (page: Page) => page.getByRole('alertdialog');

  test('overview: two-step on, and where you’re signed in', async ({
    page,
  }) => {
    await openSecurity(page);
    await expect(
      page.getByText('7 of 10 left · They expire on Oct 12, 2027.'),
    ).toBeVisible();
    await look(page, 'security');
  });

  test('its focus order', async ({ page }) => {
    await openSecurity(page);
    await page.getByLabel('Current password').focus();
    await tabsThrough(page, [
      /^Show password$/,
      /^New password$/,
      /^Show password$/,
      /^Confirm new password$/,
      /^Show password$/,
      /^Change password$/,
      /^Regenerate codes$/,
      /^Turn off$/,
      /^Remove trust from Chrome on macOS$/,
      /^Remove trust from Maya’s iPhone$/,
      /^Sign out of Maya’s iPhone$/,
      /^Sign out of Firefox on Windows$/,
      /^Remove all trusted devices$/,
      /^Sign out everywhere$/,
    ]);
  });

  test('two-step required: Turn off is disabled, with the reason', async ({
    page,
  }) => {
    await openSecurity(page, { required: true });
    await expect(page.getByRole('button', { name: 'Turn off' })).toBeDisabled();
    await look(page, 'security-required');
  });

  test('two-step off: Turn on', async ({ page }) => {
    await openSecurity(page, { twoStep: false });
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
    await look(page, 'security-off');
  });

  async function changePassword(page: Page, current: string) {
    await page.getByLabel('Current password').fill(current);
    await page.getByLabel('New password', { exact: true }).fill(STRONG);
    await page.getByLabel('Confirm new password').fill(STRONG);
    await page.getByRole('button', { name: 'Change password' }).click();
  }

  test('the current password is wrong', async ({ page }) => {
    await reply(
      page,
      'PATCH',
      '/auth/password',
      401,
      'Current password is incorrect',
    );
    await openSecurity(page);
    await changePassword(page, 'Northwind');
    await expect(
      page.getByText('That’s not your current password.'),
    ).toBeVisible();
    await look(page, 'security-wrong-current');
  });

  test('password changed: how many devices were signed out', async ({
    page,
  }) => {
    await reply(page, 'PATCH', '/auth/password', 200, {
      revokedSessionCount: 2,
    });
    await openSecurity(page);
    await changePassword(page, 'Northwind-2025');
    await expect(
      page.getByText('You were signed out on 2 other devices.'),
    ).toBeVisible();
    await look(page, 'security-password-changed');
  });

  test('no password yet: Set a password', async ({ page }) => {
    await openSecurity(page, { hasPassword: false });
    await expect(page.getByText('You sign in with Google')).toBeVisible();
    await look(page, 'security-no-password');
  });

  test('Set a password: the link is sent', async ({ page }) => {
    await reply(page, 'POST', '/auth/password/forgot', 202, null);
    await openSecurity(page, { hasPassword: false });
    await page.getByRole('button', { name: 'Set a password' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();
    await look(page, 'security-link-sent');
  });

  test('regenerating codes asks for the password', async ({ page }) => {
    await openSecurity(page);
    await page.getByRole('button', { name: 'Regenerate codes' }).click();
    await expect(
      dialog(page).getByLabel('Password', { exact: true }),
    ).toBeFocused();
    await look(page, 'security-regenerate');
  });

  test('the new codes, shown once', async ({ page }) => {
    await reply(page, 'POST', '/auth/2fa/backup-codes', 200, {
      backupCodes: BACKUP_CODES,
    });
    await openSecurity(page);
    await page.getByRole('button', { name: 'Regenerate codes' }).click();
    await dialog(page).getByLabel('Password', { exact: true }).fill(STRONG);
    await dialog(page)
      .getByRole('button', { name: 'Regenerate codes' })
      .click();
    const codes = page.getByRole('dialog', { name: 'Your new backup codes' });
    await expect(codes.getByText('V8KQ2-MX7PL')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(codes.getByRole('button', { name: 'Done' })).toBeDisabled();
    await look(page, 'security-new-codes');
  });

  test('turning two-step off asks for the password and a code', async ({
    page,
  }) => {
    await openSecurity(page);
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(
      dialog(page).getByLabel('Password', { exact: true }),
    ).toBeFocused();
    await look(page, 'security-turn-off');
  });

  test('turning off is refused while the organization requires it', async ({
    page,
  }) => {
    await reply(
      page,
      'DELETE',
      '/auth/2fa',
      400,
      'Your organization requires two-factor authentication',
    );
    await openSecurity(page);
    await page.getByRole('button', { name: 'Turn off' }).click();
    await dialog(page).getByLabel('Password', { exact: true }).fill(STRONG);
    await dialog(page)
      .getByRole('textbox', { name: 'Code from your app' })
      .fill('204815');
    await dialog(page).getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText(
      'Northwind Health requires two-step verification',
    );
    await look(page, 'security-turn-off-refused');
  });

  test('signing out everywhere asks first', async ({ page }) => {
    await openSecurity(page);
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(
      dialog(page).getByRole('button', { name: 'Cancel' }),
    ).toBeFocused();
    await look(page, 'security-sign-out-everywhere');
  });

  test('turning two-step on: scan, then confirm', async ({ page }) => {
    await reply(page, 'POST', '/auth/2fa/setup', 200, SECRET);
    await openSecurity(page, { twoStep: false });
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await look(page, 'security-turn-on');
  });

  test('turning two-step on: the backup codes', async ({ page }) => {
    await reply(page, 'POST', '/auth/2fa/setup', 200, SECRET);
    await reply(page, 'POST', '/auth/2fa/enable', 200, {
      backupCodes: BACKUP_CODES,
      user: null,
    });
    await openSecurity(page, { twoStep: false });
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Enter the 6-digit code from the app').fill('204815');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByLabel('I’ve saved my backup codes somewhere safe').check();
    await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled();
    await look(page, 'security-turn-on-codes');
  });

  test('a session signed out: a toast, and it leaves the list', async ({
    page,
  }) => {
    let sessions = SESSIONS;
    await openSecurity(page);
    await page.route(`${API}/auth/sessions**`, (route) => {
      const method = route.request().method();
      if (method === 'DELETE') {
        sessions = SESSIONS.slice(0, 2);
        return answer(route, 200, { count: 1 });
      }
      return answer(route, 200, sessions);
    });
    await page
      .getByRole('button', { name: 'Sign out of Firefox on Windows' })
      .click();
    await expect(
      page.getByText('Signed out of Firefox on Windows'),
    ).toBeVisible();
    await expect(page.getByText('192.0.2.44', { exact: false })).toBeHidden();
    await look(page, 'security-session-signed-out');
  });
});

test.describe('onboarding', () => {
  /** The checklist as auth-service words it, each step done or not. */
  const checklist = (status: string, ...complete: boolean[]) => ({
    steps: [
      { key: 'verify_email', label: 'Verify an administrator email address' },
      { key: 'create_department', label: 'Create your first department' },
      { key: 'invite_team', label: 'Invite a colleague' },
    ].map((step, index) => ({ ...step, complete: complete[index] ?? false })),
    canComplete: complete.length === 3 && complete.every(Boolean),
    status,
  });
  const ONBOARDING = '/organizations/current/onboarding';

  async function openTickets(page: Page, person: Person) {
    await signInAs(page, person);
    await page.goto('/tickets');
    await expect(
      page.getByRole('heading', { name: 'Set up Northwind Health' }),
    ).toBeVisible();
  }

  test('the founder, 1 of 3 done', async ({ page }) => {
    const { maya } = await tenant('onboarding');
    await reply(
      page,
      'GET',
      ONBOARDING,
      200,
      checklist('PENDING_ONBOARDING', true, false, false),
    );
    await openTickets(page, maya);
    await expect(page.getByText('1 of 3 steps done')).toBeVisible();
    await look(page, 'onboarding');
  });

  test('unverified: inviting waits for the email', async ({ page }) => {
    const { maya } = await tenant('onboarding-unverified');
    await setEmailVerified([maya], false);
    await reply(
      page,
      'GET',
      ONBOARDING,
      200,
      checklist('PENDING_ONBOARDING', false, true, false),
    );
    await openTickets(page, maya);
    await expect(page.getByText('Verify your email first')).toBeVisible();
    await look(page, 'onboarding-unverified');
  });

  test('every step done: Finish setup', async ({ page }) => {
    const { maya } = await tenant('onboarding');
    await reply(
      page,
      'GET',
      ONBOARDING,
      200,
      checklist('PENDING_ONBOARDING', true, true, true),
    );
    await openTickets(page, maya);
    await expect(
      page.getByRole('button', { name: 'Finish setup' }),
    ).toBeEnabled();
    await look(page, 'onboarding-done');
  });

  test('setup is already finished: a toast, and the panel goes', async ({
    page,
  }) => {
    const { maya } = await tenant('onboarding');
    let finished = false;
    await page.route(`${API}${ONBOARDING}**`, (route) => {
      if (route.request().method() === 'POST') {
        finished = true;
        return answer(
          route,
          409,
          'This workspace is ACTIVE, not pending onboarding',
        );
      }
      return answer(
        route,
        200,
        finished
          ? checklist('ACTIVE', true, true, true)
          : checklist('PENDING_ONBOARDING', true, true, true),
      );
    });
    await openTickets(page, maya);
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByText('Setup is already finished')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Set up Northwind Health' }),
    ).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeFocused();
    await look(page, 'onboarding-already-finished');
  });
});

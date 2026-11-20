import { expect, test, type Page, type Route } from '../coverage';
import { signInInPopup } from '../firebase';
import { look, tabsThrough } from './look';

/**
 * The sign-in screens, in every state, light and dark, at both widths. The
 * gateway's answers are faked at the browser (`page.route`): each leg is a
 * client call, the journeys in `sign-in.e2e-spec.ts` prove the real ones, and
 * a faked answer is the same on every run and spends no sign-in budget.
 */

const API = '**/api/v1';

/** The gateway's envelope, as `page.route` answers it. */
function answer(route: Route, status: number, data: unknown): Promise<void> {
  const ok = status < 400;
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: status === 429 ? { 'retry-after': '120' } : {},
    body: JSON.stringify(
      ok
        ? { success: true, statusCode: status, message: 'OK', data }
        : { success: false, statusCode: status, error: data },
    ),
  });
}

/** Answers every call to `path` the same way. */
async function reply(
  page: Page,
  path: string,
  status: number,
  data: unknown = null,
): Promise<void> {
  await page.route(`${API}${path}`, (route) => answer(route, status, data));
}

/** Holds every call to `path` unanswered: the screen's busy state. */
async function hold(page: Page, path: string): Promise<void> {
  await page.route(`${API}${path}`, () => undefined);
}

/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Email').fill('priya@northwind.example');
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const CODE = { requiresTwoFactor: true, requiresTwoFactorSetup: false };
const SETUP = { requiresTwoFactor: true, requiresTwoFactorSetup: true };
const SECRET = {
  otpauthUri:
    'otpauth://totp/SynapseDesk:priya%40northwind.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SynapseDesk',
  // A blank 1×1 PNG: the QR's place, without a picture that varies.
  qrCodeDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
};
const BACKUP_CODES = [
  'ABCDE-12345',
  'FGHJK-23456',
  'LMNPQ-34567',
  'RSTUV-45678',
  'WXYZA-56789',
  'BCDEF-67891',
  'GHJKL-78912',
  'MNPQR-89123',
];

test.describe('sign-in', () => {
  test('default', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeFocused();
    await look(page, 'sign-in');
  });

  test('its focus order', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeFocused();
    await tabsThrough(page, [
      /^Forgot password\?$/,
      /^Password$/,
      /^Show password$/,
      /^Sign in$/,
      /^Sign up$/,
    ]);
  });

  test('Google sign-in failed: try again, or use email and password', async ({
    page,
  }) => {
    await reply(page, '/auth/google', 401, 'Invalid Google token');
    await page.goto('/login');
    const opened = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await signInInPopup(await opened, 'sam@google.example.test', 'Sam Rivera');
    await expect(alert(page)).toContainText('Couldn’t sign in with Google');
    await look(page, 'sign-in-google-failed');
  });

  test('a field left empty or malformed says how to fix it', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('priya');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByText('Enter an email address like name@company.com.'),
    ).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await look(page, 'sign-in-invalid');
  });

  test('wrong credentials: one message for both fields', async ({ page }) => {
    await reply(page, '/auth/login', 401, 'Invalid credentials');
    await page.goto('/login');
    await signIn(page);
    await expect(alert(page)).toContainText('Email or password is incorrect');
    await expect(page.getByLabel('Email')).toBeFocused();
    await look(page, 'sign-in-wrong');
  });

  test('429: paused, with the minutes to wait', async ({ page }) => {
    await reply(page, '/auth/login', 429, 'Too many requests');
    await page.goto('/login');
    await signIn(page);
    await expect(alert(page)).toContainText(
      'For your security, sign-in is paused. Try again in 2 minutes.',
    );
    await look(page, 'sign-in-throttled');
  });

  test('busy while signing in', async ({ page }) => {
    await hold(page, '/auth/login');
    await page.goto('/login');
    await signIn(page);
    await expect(
      page.getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    await look(page, 'sign-in-busy');
  });

  for (const [name, query, text] of [
    ['session-ended', '?next=%2Ftickets', 'Your session ended'],
    ['signed-out', '?signed-out', 'You’ve signed out'],
    ['reset', '?reset', 'Your password is changed'],
    [
      'reset-signed-out-elsewhere',
      '?reset&others=1',
      'You’ve been signed out on your other devices.',
    ],
    [
      'signed-out-everywhere',
      '?signed-out-everywhere=3',
      '3 sessions ended. Sign in again to continue.',
    ],
  ] as const) {
    test(`why you're here: ${name}`, async ({ page }) => {
      await page.goto(`/login${query}`);
      await expect(page.getByText(text)).toBeVisible();
      await look(page, `sign-in-${name}`);
    });
  }
});

test.describe('the password field', () => {
  const field = (page: Page) =>
    page.getByLabel('Password', { exact: true }).locator('..');

  test('idle, hovered, focused from the keyboard, and shown', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill('Passw0rd!');
    await look(page, 'password-idle', { target: field(page) });

    await page.getByRole('button', { name: 'Show password' }).hover();
    await look(page, 'password-hovered', { target: field(page) });

    await page.getByLabel('Password', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Show password' }),
    ).toBeFocused();
    await look(page, 'password-focused', { target: field(page) });

    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Hide password' }),
    ).toBeVisible();
    await look(page, 'password-shown', { target: field(page) });
  });
});

test.describe('two-step code', () => {
  test.beforeEach(async ({ page }) => {
    await reply(page, '/auth/login', 200, CODE);
    await page.goto('/login');
    await signIn(page);
    await expect(
      page.getByRole('heading', { name: 'Two-step verification' }),
    ).toBeVisible();
  });

  test('default', async ({ page }) => {
    await expect(page.getByLabel('Verification code')).toBeFocused();
    await look(page, 'two-step-code');
  });

  test('its focus order', async ({ page }) => {
    await expect(page.getByLabel('Verification code')).toBeFocused();
    await tabsThrough(page, [
      /^Remember this device$/,
      /^Verify$/,
      /^Use a backup code instead$/,
      /^Back to sign in$/,
    ]);
  });

  test('a wrong or expired code', async ({ page }) => {
    await reply(
      page,
      '/auth/2fa/authenticate',
      401,
      'Invalid verification code',
    );
    await page.getByLabel('Verification code').fill('123456');
    await expect(alert(page)).toContainText(
      'That code is wrong or has expired.',
    );
    await look(page, 'two-step-code-wrong');
  });

  test('a backup code instead, and a wrong one', async ({ page }) => {
    await page
      .getByRole('button', { name: 'Use a backup code instead' })
      .click();
    await expect(page.getByLabel('Backup code')).toBeVisible();
    await look(page, 'two-step-backup');

    await reply(page, '/auth/2fa/authenticate', 401, 'Invalid backup code');
    await page.getByLabel('Backup code').fill('ABCDE-12345');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(alert(page)).toContainText(
      'That backup code is wrong or has already been used.',
    );
    await look(page, 'two-step-backup-wrong');
  });

  test('429: paused', async ({ page }) => {
    await reply(page, '/auth/2fa/authenticate', 429, 'Too many requests');
    await page.getByLabel('Verification code').fill('123456');
    await expect(alert(page)).toContainText('verification is paused');
    await look(page, 'two-step-code-throttled');
  });

  test('busy while verifying', async ({ page }) => {
    await hold(page, '/auth/2fa/authenticate');
    await page.getByLabel('Verification code').fill('123456');
    await expect(
      page.getByRole('button', { name: 'Verifying…' }),
    ).toBeVisible();
    await look(page, 'two-step-code-busy');
  });
});

test.describe('a Super Admin', () => {
  test('a code every time: no "Remember this device"', async ({ page }) => {
    await reply(page, '/auth/login', 200, {
      ...CODE,
      canRememberDevice: false,
    });
    await page.goto('/login');
    await signIn(page);
    await expect(
      page.getByText('Super Admins enter a code every time they sign in.'),
    ).toBeVisible();
    await expect(page.getByLabel('Remember this device')).toHaveCount(0);
    await look(page, 'two-step-code-super-admin');
  });

  test('without two-step: must set it up', async ({ page }) => {
    await reply(page, '/auth/login', 200, {
      ...SETUP,
      canRememberDevice: false,
    });
    await reply(page, '/auth/2fa/setup', 200, SECRET);
    await page.goto('/login');
    await signIn(page);
    await expect(
      page.getByText(
        /^Super Admins must use a second step when they sign in\./,
      ),
    ).toBeVisible();
    await look(page, 'two-step-setup-super-admin');
  });
});

test.describe('two-step setup', () => {
  test.beforeEach(async ({ page }) => {
    await reply(page, '/auth/login', 200, SETUP);
    await reply(page, '/auth/2fa/setup', 200, SECRET);
    await page.goto('/login');
    await signIn(page);
    await expect(page.locator('code')).toHaveText(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
  });

  test('step 1', async ({ page }) => {
    await look(page, 'two-step-setup');
  });

  test('step 1: its focus order', async ({ page }) => {
    await page.locator('code').click();
    await tabsThrough(page, [
      /^Copy key$/,
      /^Enter the 6-digit code from the app$/,
    ]);
  });

  test("step 1: a code that didn't match", async ({ page }) => {
    await reply(page, '/auth/2fa/enable', 401, 'Invalid authentication code');
    await page.getByLabel('Enter the 6-digit code from the app').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(alert(page)).toContainText('That code didn’t match.');
    await look(page, 'two-step-setup-wrong');
  });

  test('step 2: the backup codes', async ({ page }) => {
    await reply(page, '/auth/2fa/enable', 200, {
      backupCodes: BACKUP_CODES,
      user: null,
    });
    await page.getByLabel('Enter the 6-digit code from the app').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Save your backup codes' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await look(page, 'two-step-setup-codes');
  });

  test('step 2: its focus order', async ({ page }) => {
    await reply(page, '/auth/2fa/enable', 200, {
      backupCodes: BACKUP_CODES,
      user: null,
    });
    await page.getByLabel('Enter the 6-digit code from the app').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Save your backup codes' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('heading', { name: 'Save your backup codes' }).click();
    await tabsThrough(page, [
      /^Copy codes$/,
      /^Download$/,
      /^I’ve saved my backup codes somewhere safe$/,
      /^Continue$/,
    ]);
  });
});

test.describe('choose an organization', () => {
  const TENANTS = {
    requiresTenantSelection: true,
    tenants: [
      {
        organizationId: '11111111-1111-4111-8111-111111111111',
        name: 'Northwind Health',
        slug: 'northwind-health',
      },
      {
        organizationId: '22222222-2222-4222-8222-222222222222',
        name: 'Contoso Retail',
        slug: 'contoso-retail',
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await reply(page, '/auth/login', 200, TENANTS);
    await page.goto('/login');
    await signIn(page);
    await expect(
      page.getByRole('heading', { name: 'Choose an organization' }),
    ).toBeVisible();
  });

  test('default', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Northwind Health/ }),
    ).toBeFocused();
    await look(page, 'choose-organization');
  });

  test('its focus order', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Northwind Health/ }),
    ).toBeFocused();
    await tabsThrough(page, [/Contoso Retail/, /^Back to sign in$/]);
  });

  test('the chosen one spins, the others dim', async ({ page }) => {
    await hold(page, '/auth/login/tenant');
    await page.getByRole('button', { name: /Northwind Health/ }).click();
    await expect(
      page.getByRole('button', { name: /Northwind Health/ }),
    ).toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByRole('button', { name: /Contoso Retail/ }),
    ).toBeDisabled();
    await look(page, 'choose-organization-busy');
  });

  test("couldn't sign in to one", async ({ page }) => {
    await reply(page, '/auth/login/tenant', 500, 'Internal server error!');
    await page.getByRole('button', { name: /Northwind Health/ }).click();
    await expect(alert(page)).toContainText(
      'Couldn’t sign in to Northwind Health',
    );
    await look(page, 'choose-organization-error');
  });
});

test.describe('forgot password', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(
      page.getByRole('heading', { name: 'Reset your password' }),
    ).toBeVisible();
  });

  const send = (page: Page, email = 'priya@northwind.example') =>
    page
      .getByLabel('Email')
      .fill(email)
      .then(() => page.getByRole('button', { name: 'Send link' }).click());

  test('default', async ({ page }) => {
    await look(page, 'forgot-password');
  });

  test('a malformed email', async ({ page }) => {
    await send(page, 'priya');
    await expect(
      page.getByText('Enter an email address like name@company.com.'),
    ).toBeVisible();
    await look(page, 'forgot-password-invalid');
  });

  test('sent: check your email', async ({ page }) => {
    await reply(page, '/auth/password/forgot', 200, null);
    await send(page);
    await expect(page.getByText('Check your email')).toBeVisible();
    await look(page, 'forgot-password-sent');
  });

  test('429: paused', async ({ page }) => {
    await reply(page, '/auth/password/forgot', 429, 'Too many requests');
    await send(page);
    await expect(alert(page)).toBeVisible();
    await look(page, 'forgot-password-throttled');
  });

  test("couldn't send", async ({ page }) => {
    await reply(page, '/auth/password/forgot', 500, 'Internal server error!');
    await send(page);
    await expect(page.getByText('Couldn’t send the link')).toBeVisible();
    await look(page, 'forgot-password-error');
  });
});

test.describe('reset password', () => {
  const TOKEN = 'a'.repeat(64);

  test('checking the link', async ({ page }) => {
    await hold(page, `/auth/password/reset/${TOKEN}`);
    await page.goto(`/reset-password?token=${TOKEN}`);
    await expect(page.getByText('Checking your link…')).toBeVisible();
    await look(page, 'reset-password-checking');
  });

  test('a link that no longer works', async ({ page }) => {
    await reply(page, `/auth/password/reset/${TOKEN}`, 200, { valid: false });
    await page.goto(`/reset-password?token=${TOKEN}`);
    await expect(
      page.getByRole('heading', { name: 'This link no longer works' }),
    ).toBeVisible();
    await look(page, 'reset-password-dead-link');
  });

  test.describe('a live link', () => {
    test.beforeEach(async ({ page }) => {
      await reply(page, `/auth/password/reset/${TOKEN}`, 200, {
        valid: true,
        email: 'priya@northwind.example',
      });
      await page.goto(`/reset-password?token=${TOKEN}`);
      await expect(
        page.getByLabel('New password', { exact: true }),
      ).toBeVisible();
    });

    test('default', async ({ page }) => {
      await look(page, 'reset-password');
    });

    test('the checklist ticks, and a mismatch says so', async ({ page }) => {
      await page.getByLabel('New password', { exact: true }).fill('Passw0rd!');
      await page.getByLabel('Confirm new password').fill('Passw0rd?');
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(alert(page)).toContainText('The passwords don’t match.');
      await look(page, 'reset-password-mismatch');
    });

    test("couldn't set it", async ({ page }) => {
      await reply(page, '/auth/password/reset', 500, 'Internal server error!');
      await page.getByLabel('New password', { exact: true }).fill('Passw0rd!');
      await page.getByLabel('Confirm new password').fill('Passw0rd!');
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page.getByText('Couldn’t set the password')).toBeVisible();
      await look(page, 'reset-password-error');
    });
  });
});

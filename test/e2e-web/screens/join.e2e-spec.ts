import { expect, test, type Page, type Route } from '@playwright/test';
import { look, tabsThrough } from './look';

/**
 * Joining: sign up and verify your email, in every state, light and dark, at
 * both widths. The gateway's answers are faked at the browser (`page.route`):
 * the journeys prove the real ones, and a faked answer is the same on every
 * run. The clock is fixed, so a countdown or an expiry reads the same too.
 */

const API = '**/api/v1';
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
  path: string,
  status: number,
  data: unknown = null,
  retryAfter?: number,
): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    answer(route, status, data, retryAfter),
  );
}

/** Holds every call to `path` unanswered: the screen's busy state. */
async function hold(page: Page, path: string): Promise<void> {
  await page.route(`${API}${path}`, () => undefined);
}

/** The page's own alert: Next.js's route announcer is an `alert` too. */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

test.describe('sign up', () => {
  async function fill(
    page: Page,
    name: string,
    email: string,
    password: string,
  ) {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
  }

  test('default: the checklist ticks as the password is typed', async ({
    page,
  }) => {
    await fill(page, 'Maya Chen', 'maya@northwind.health', 'Northwind');
    await expect(page.getByLabel('An uppercase letter, met')).toBeVisible();
    await look(page, 'sign-up');
  });

  test('its focus order', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByRole('button', { name: 'Continue with Google' }).focus();
    await tabsThrough(page, [
      /^Full name$/,
      /^Work email$/,
      /^Password$/,
      /^Show password$/,
      /^Create account$/,
      /^Sign in$/,
    ]);
  });

  test('field errors say what each field needs', async ({ page }) => {
    await fill(page, 'M', 'maya@northwind', 'northwind12');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByText('Your password needs an uppercase letter and a symbol.'),
    ).toBeVisible();
    await look(page, 'sign-up-invalid');
  });

  test('429: paused, with the minutes to wait', async ({ page }) => {
    await reply(page, '/auth/register', 429, 'Too many requests', 600);
    await fill(page, 'Maya Chen', 'maya@northwind.health', 'Northwind-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(alert(page)).toContainText(
      'For your security, sign-up is paused. Try again in 10 minutes.',
    );
    await look(page, 'sign-up-throttled');
  });

  test('creating the account', async ({ page }) => {
    await hold(page, '/auth/register');
    await fill(page, 'Maya Chen', 'maya@northwind.health', 'Northwind-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByRole('button', { name: 'Creating account…' }),
    ).toBeDisabled();
    await look(page, 'sign-up-busy');
  });

  test('done: one screen for every valid form', async ({ page }) => {
    await reply(page, '/auth/register', 201, {
      email: 'maya@northwind.health',
      requiresEmailVerification: true,
    });
    await fill(page, 'Maya Chen', 'maya@northwind.health', 'Northwind-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Check your email, then sign in' }),
    ).toBeFocused();
    await look(page, 'sign-up-done');
  });
});

test.describe('verify your email', () => {
  const ME = {
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'maya@northwind.health',
      fullName: 'Maya Chen',
      isEmailVerified: false,
    },
    permissionCodes: [],
    departmentIds: [],
    hasPassword: true,
  };
  const PENDING = {
    pending: true,
    target: 'm***a@northwind.health',
    expiresAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    attemptsRemaining: 5,
    codeLength: 6,
  };
  const NONE = {
    pending: false,
    target: null,
    expiresAt: null,
    attemptsRemaining: 0,
    codeLength: 6,
  };
  const SENT = {
    target: 'm***a@northwind.health',
    expiresInMinutes: 10,
    codeLength: 6,
  };

  /** Opens the screen with no code out, so it sends one. */
  async function open(page: Page, status: object = NONE) {
    await page.clock.setFixedTime(NOW);
    await reply(page, '/users/me', 200, ME);
    await reply(page, '/auth/otp/status?*', 200, status);
    await page.goto('/verify-email');
  }

  const code = (page: Page) => page.getByLabel('Verification code');
  const verify = async (page: Page) => {
    await code(page).fill('481920');
  };

  test('sending the code', async ({ page }) => {
    await hold(page, '/auth/email/verify/request');
    await open(page);
    await expect(
      page.getByText('Sending a code to m***a@northwind.health…'),
    ).toBeVisible();
    await look(page, 'verify-email-sending');
  });

  test('sent: a minute before it can be resent', async ({ page }) => {
    await reply(page, '/auth/email/verify/request', 202, SENT);
    await open(page);
    await expect(page.getByText('Resend code in 1:00')).toBeVisible();
    await look(page, 'verify-email-sent');
  });

  test('its focus order', async ({ page }) => {
    await open(page, PENDING);
    await expect(code(page)).toBeFocused();
    await tabsThrough(page, [/^Verify$/, /^Resend code$/, /^Verify later$/]);
  });

  test('too many code requests: the countdown follows Retry-After', async ({
    page,
  }) => {
    await reply(
      page,
      '/auth/email/verify/request',
      429,
      'Too many requests',
      480,
    );
    await open(page, PENDING);
    await page.getByRole('button', { name: 'Resend code' }).click();
    await expect(alert(page)).toContainText('Too many code requests');
    await expect(page.getByText('Resend code in 8:00')).toBeVisible();
    await look(page, 'verify-email-too-many-requests');
  });

  test('verifying', async ({ page }) => {
    await hold(page, '/auth/email/verify');
    await open(page, PENDING);
    await verify(page);
    await expect(
      page.getByRole('button', { name: 'Verifying…' }),
    ).toBeDisabled();
    await look(page, 'verify-email-verifying');
  });

  test('a wrong code, with the attempts left', async ({ page }) => {
    await reply(page, '/auth/email/verify', 200, {
      verified: false,
      attemptsRemaining: 3,
      mustRequestNewCode: false,
    });
    await open(page, PENDING);
    await verify(page);
    await expect(alert(page)).toContainText(
      'That code is wrong. You have 3 attempts left.',
    );
    await look(page, 'verify-email-wrong');
  });

  test('too many incorrect attempts: a new code at once', async ({ page }) => {
    await reply(
      page,
      '/auth/email/verify',
      429,
      'Too many incorrect attempts. Request a new code.',
    );
    await open(page, PENDING);
    await verify(page);
    await expect(
      page.getByRole('button', { name: 'Request a new code' }),
    ).toBeFocused();
    await look(page, 'verify-email-out-of-attempts');
  });

  test('the code expired', async ({ page }) => {
    await reply(
      page,
      '/auth/email/verify',
      400,
      'No verification code is pending. Request a new one.',
    );
    await open(page, PENDING);
    await verify(page);
    await expect(alert(page)).toContainText(
      'That code has expired. Send yourself a new one.',
    );
    await look(page, 'verify-email-expired');
  });

  test('verified', async ({ page }) => {
    await reply(page, '/auth/email/verify', 200, {
      verified: true,
      attemptsRemaining: 4,
      mustRequestNewCode: false,
    });
    await open(page, PENDING);
    await verify(page);
    await expect(
      page.getByRole('heading', { name: 'Email verified' }),
    ).toBeFocused();
    await look(page, 'verify-email-verified');
  });
});

test.describe('accept an invitation', () => {
  const VALID = {
    valid: true,
    organizationName: 'Northwind Health',
    inviterName: 'Jordan Lee',
    email: 'priya@northwind.health',
    roleNames: ['Agent', 'Knowledge manager'],
    expiresAt: '2026-10-20T12:00:00Z',
  };
  const PREVIEW = '/users/invitations/token/tok-1';

  async function open(page: Page) {
    await reply(page, PREVIEW, 200, VALID);
    await page.goto('/invitations/accept?token=tok-1');
    await expect(
      page.getByRole('heading', { name: 'Join Northwind Health' }),
    ).toBeVisible();
  }

  async function fill(page: Page, name: string, password: string) {
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(password);
  }

  test('checking the link', async ({ page }) => {
    await hold(page, PREVIEW);
    await page.goto('/invitations/accept?token=tok-1');
    await expect(page.getByText('This takes a moment.')).toBeVisible();
    await look(page, 'invitation-checking');
  });

  test('valid: who invited you, to what, as what', async ({ page }) => {
    await open(page);
    await fill(page, 'Priya Shah', 'northwind12');
    await look(page, 'invitation');
  });

  test('its focus order', async ({ page }) => {
    await open(page);
    await page.getByLabel('Email').focus();
    await tabsThrough(page, [
      /^Full name$/,
      /^Password$/,
      /^Show password$/,
      /^Join Northwind Health$/,
    ]);
  });

  test('field errors', async ({ page }) => {
    await open(page);
    await fill(page, 'P', 'northwind12');
    await page.getByRole('button', { name: 'Join Northwind Health' }).click();
    await expect(
      page.getByText('Your password needs an uppercase letter and a symbol.'),
    ).toBeVisible();
    await look(page, 'invitation-invalid');
  });

  test('joining', async ({ page }) => {
    await hold(page, '/users/invitations/accept');
    await open(page);
    await fill(page, 'Priya Shah', 'Northwind-26');
    await page.getByRole('button', { name: 'Join Northwind Health' }).click();
    await expect(page.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    await look(page, 'invitation-joining');
  });

  test('can’t be used: one state for used, expired, revoked and unknown', async ({
    page,
  }) => {
    await reply(page, PREVIEW, 200, { ...VALID, valid: false });
    await page.goto('/invitations/accept?token=tok-1');
    await expect(
      page.getByRole('heading', {
        name: 'This invitation can’t be used anymore',
      }),
    ).toBeVisible();
    await look(page, 'invitation-cant-be-used');
  });
});

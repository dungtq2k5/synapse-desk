/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_ROUTES } from '@synapsedesk/contracts';
import {
  absoluteTime,
  clockTime,
  fileSize,
  firstName,
  initials,
  relativeTime,
} from './format';
import { PASSWORD_RULES } from './password-rules';
import { ok, stubApi } from '@/test/api';
import {
  afterSignIn,
  deviceName,
  minutesFrom,
  safeNext,
  signInStep,
} from './sign-in';

describe('safeNext', () => {
  it.each([
    ['/tickets/42?tab=1', '/tickets/42?tab=1'],
    ['/', '/'],
    [null, '/tickets'],
    ['', '/tickets'],
    ['//evil.example/x', '/tickets'],
    ['/\\evil.example', '/tickets'],
    ['https://evil.example', '/tickets'],
    ['tickets', '/tickets'],
  ])('%s → %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

it.each([
  WEB_ROUTES.resetPassword,
  // The sign-up attempt email's two links.
  WEB_ROUTES.login,
  WEB_ROUTES.forgotPassword,
  WEB_ROUTES.acceptInvitation,
])('serves %s, where an email links', (route) => {
  const page = join(__dirname, '../app/(auth)', route, 'page.tsx');
  expect(existsSync(page)).toBe(true);
});

describe('afterSignIn', () => {
  const status = (pending: boolean) =>
    ok({ pending, target: null, expiresAt: null, attemptsRemaining: 5 });
  const me = (isEmailVerified: boolean) =>
    ok({ user: { isEmailVerified }, permissionCodes: [], hasPassword: true });

  it.each([
    [true, false, '/verify-email?next=%2Ftickets%2F42'],
    [true, true, '/tickets/42'],
    [false, false, '/tickets/42'],
  ])(
    'a code pending: %s, the address verified: %s, goes to %s',
    async (pending, verified, where) => {
      stubApi({
        'GET /api/v1/auth/otp/status': status(pending),
        'GET /api/v1/users/me': me(verified),
      });
      await expect(afterSignIn('/tickets/42')).resolves.toBe(where);
    },
  );

  it('goes straight on when the check fails', async () => {
    stubApi({});
    await expect(afterSignIn('/tickets/42')).resolves.toBe('/tickets/42');
  });
});

describe('signInStep', () => {
  const user = {} as never;

  it('reads each answer of a sign-in leg', () => {
    expect(signInStep({ requiresTwoFactor: false, user })).toEqual({
      kind: 'signed-in',
    });
    expect(
      signInStep({ requiresTwoFactor: true, requiresTwoFactorSetup: false }),
    ).toEqual({ kind: 'code' });
    // Setup wins: there is no code to ask for yet.
    expect(
      signInStep({ requiresTwoFactor: true, requiresTwoFactorSetup: true }),
    ).toEqual({ kind: 'setup' });
    const tenants = [{ organizationId: 'o', name: 'Northwind', slug: 'nw' }];
    expect(signInStep({ requiresTenantSelection: true, tenants })).toEqual({
      kind: 'tenant',
      tenants,
    });
  });
});

describe('deviceName and minutesFrom', () => {
  it('names the browser and system', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(deviceName('curl/8')).toBe('Browser');
  });

  it('rounds Retry-After up to whole minutes, at least one', () => {
    expect(minutesFrom(1)).toBe(1);
    expect(minutesFrom(60)).toBe(1);
    expect(minutesFrom(61)).toBe(2);
    expect(minutesFrom(900)).toBe(15);
  });
});

describe('the password checklist', () => {
  // The document's pattern for ResetPasswordDto.newPassword, as auth-service
  // enforces it.
  const document = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../docs/reference/openapi.json'),
      'utf8',
    ),
  ) as {
    components: {
      schemas: Record<
        string,
        { properties: Record<string, { pattern?: string }> }
      >;
    };
  };
  const serverRule = new RegExp(
    document.components.schemas.ResetPasswordDto.properties.newPassword
      .pattern as string,
  );

  it.each([
    'Correct-Horse1',
    'Abcdefg1€',
    'abcdefg1!',
    'ABCDEFG1!',
    'Abcdefgh!',
    'Abc1!',
    'Abcdefg1 ',
    'Abcdefg1£',
    'Abcdefg1\\',
    'Abcdefg1§',
  ])('agrees with the server on %j', (password) => {
    expect(PASSWORD_RULES.every((rule) => rule.test(password))).toBe(
      serverRule.test(password),
    );
  });
});

describe('format', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it.each([
    [ago(20_000), 'Just now'],
    [ago(5 * 60_000), '5 min ago'],
    [ago(3 * 3_600_000), '3 hr ago'],
    ['2026-10-11T20:00:00Z', 'Yesterday'],
    ['2026-10-09T08:00:00Z', '3 days ago'],
    ['2026-10-03T08:00:00Z', 'Last week'],
    ['2026-09-20T08:00:00Z', '20 Sept'],
  ])('relativeTime(%s) is %s', (at, expected) => {
    expect(relativeTime(at, now, 'UTC')).toBe(expected);
  });

  it('formats absolute times, clock times, sizes and names', () => {
    expect(absoluteTime('2026-10-10T09:12:00Z', 'UTC')).toBe(
      '10 Oct 2026, 09:12',
    );
    expect(clockTime('2026-10-10T09:12:00Z', 'UTC')).toBe('09:12');
    expect(fileSize(217_088)).toBe('212 KB');
    expect(fileSize(1_258_291)).toBe('1.2 MB');
    expect(fileSize(900)).toBe('900 B');
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('Priya Anand Shah')).toBe('PS');
    expect(initials('Cher')).toBe('C');
    expect(firstName('Priya Shah')).toBe('Priya');
  });
});

import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { compareAlphabetically } from '@synapsedesk/common';
import {
  ACCESS_COOKIE,
  API,
  E2eFixture,
  REFRESH_COOKIE,
  TENANT_SELECTION_COOKIE,
  TWO_FA_COOKIE,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
  parseSetCookie,
  twoFactorChallengeAgent,
} from '../utils';
import {
  grpcError,
  wireLoginSuccess,
  wireLoginTenantSelection,
  wireLoginTwoFactor,
  wireUser,
} from '../fixtures/wire';

/**
 * The gateway half of auth, 2FA and OTP: the rows the test plan marks "e2e".
 *
 * Everything here is about the HTTP boundary — which cookies are set, what the
 * body does and does not carry, which guard admits which caller. The business
 * rules behind them live in the integration suites, and auth-service is stubbed
 * precisely so a failure here can only mean the gateway.
 */
describe('auth at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    // The auth routes are throttled at 5 per 15 minutes per (ip, account),
    // which several tests here would otherwise exhaust between them.
    await flushTestRedis();
    // Call RECORDS only — `clearAllMocks` leaves the implementations each test
    // installs intact, where `resetAllMocks` would strip them. Without this, a
    // `not.toHaveBeenCalled()` assertion reads every earlier test's calls too.
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------------------- login

  describe('POST /auth/login', () => {
    it('7. a clean login sets the cookies and puts NO token in the body', async () => {
      // HttpOnly cookies are unreadable by JS, which is the whole point —
      // echoing the tokens into the body hands them to any XSS on the page.
      fx.stubs.auth.login.mockReturnValue(of(wireLoginSuccess()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'clean@login.test', password: 'Passw0rd!' });

      expect(res.status).toBe(200);

      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[ACCESS_COOKIE]).toBeDefined();
      expect(cookies[REFRESH_COOKIE]).toBeDefined();

      expect(res.body.data).not.toHaveProperty('accessToken');
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(res.body)).not.toContain('access-token-fixture');
      expect(JSON.stringify(res.body)).not.toContain('refresh-token-fixture');
    });

    it('7b. every cookie the login sets is HttpOnly with the configured SameSite', async () => {
      fx.stubs.auth.login.mockReturnValue(of(wireLoginSuccess()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'flags@login.test', password: 'Passw0rd!' });

      const cookies = parseSetCookie(res.headers['set-cookie']);
      for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
        expect(cookies[name].httpOnly).toBe(true);
        expect(cookies[name].sameSite).toBe(
          (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase(),
        );
      }
    });

    it('8. an address in two tenants sets ONLY the tenant-selection cookie', async () => {
      // No access cookie, because nothing has been authorized yet: the password
      // matched several accounts and none has been chosen.
      fx.stubs.auth.login.mockReturnValue(of(wireLoginTenantSelection()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'multi@tenants.test', password: 'Passw0rd!' });

      expect(res.status).toBe(200);
      expect(res.body.data.requiresTenantSelection).toBe(true);
      expect(res.body.data.tenants).toHaveLength(2);

      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[TENANT_SELECTION_COOKIE]).toBeDefined();
      expect(cookies[TENANT_SELECTION_COOKIE].httpOnly).toBe(true);
      expect(cookies[ACCESS_COOKIE]).toBeUndefined();
      expect(cookies[REFRESH_COOKIE]).toBeUndefined();
    });

    it('9. a 2FA challenge sets ONLY the challenge cookie', async () => {
      fx.stubs.auth.login.mockReturnValue(of(wireLoginTwoFactor()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'twofa@login.test', password: 'Passw0rd!' });

      expect(res.body.data.requiresTwoFactor).toBe(true);

      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[TWO_FA_COOKIE]).toBeDefined();
      expect(cookies[TWO_FA_COOKIE].httpOnly).toBe(true);
      expect(cookies[ACCESS_COOKIE]).toBeUndefined();
      expect(cookies[REFRESH_COOKIE]).toBeUndefined();
    });

    it('9b. an ENROLMENT challenge tells the client to open setup, not to prompt', async () => {
      // The same cookie means "enter your code" in one case and "enrol now" in
      // the other, and only the server knows which. Collapsing them is what turns
      // `enforce_two_factor` into a tenant-wide lockout.
      fx.stubs.auth.login.mockReturnValue(of(wireLoginTwoFactor(true)));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'enrol@login.test', password: 'Passw0rd!' });

      expect(res.body.data).toMatchObject({
        requiresTwoFactor: true,
        requiresTwoFactorSetup: true,
      });
    });

    it('13. a wrong password and an unknown address are indistinguishable', async () => {
      fx.stubs.auth.login.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAUTHENTICATED, 'Invalid credentials'),
        ),
      );

      const wrong = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'known@enumeration.test', password: 'Wrong!' });
      const unknown = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'ghost@enumeration.test', password: 'Wrong!' });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toBe(unknown.body.error);
    });
  });

  describe('POST /auth/login/tenant', () => {
    it('a live session cannot start a new login — GuestGuard', async () => {
      // 400, not 401 or 403: nothing is wrong with the caller's credentials, the
      // REQUEST is the mistake — they already hold a session. An expired or
      // tampered cookie deliberately falls through instead, so a stale token can
      // never lock someone out of the login form.
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'again@guest.test', password: 'Passw0rd!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already logged in/i);
      expect(fx.stubs.auth.login).not.toHaveBeenCalled();
    });

    it('login/tenant without the selection cookie is 401, and never reaches the service', async () => {
      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login/tenant`)
        .send({ organizationId: '00000000-0000-4000-8000-000000000001' });

      expect(res.status).toBe(401);
      expect(fx.stubs.auth.loginWithTenant).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/google', () => {
    it('login/tenant relays the cookie verbatim — the gateway never verifies it', async () => {
      // The tenant-selection token is opaque here by design: auth-service signed
      // it and auth-service checks it. What the gateway must do is carry it.
      fx.stubs.auth.loginWithTenant.mockReturnValue(of(wireLoginSuccess()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login/tenant`)
        .set('Cookie', `${TENANT_SELECTION_COOKIE}=opaque-string-from-leg-one`)
        .send({ organizationId: '00000000-0000-4000-8000-000000000001' });

      expect(res.status).toBe(200);
      const [request] = fx.stubs.auth.loginWithTenant.mock.calls[0] as [
        { tenantSelectionToken: string; organizationId: string },
      ];
      expect(request.tenantSelectionToken).toBe('opaque-string-from-leg-one');

      // Spent either way: a set of accounts was named and one has been chosen.
      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[TENANT_SELECTION_COOKIE].value).toBe('');
    });
  });

  describe('password routes', () => {
    it('27. Google sign-in can still return a 2FA challenge', async () => {
      // Google proves the FIRST factor only.
      fx.stubs.auth.googleSignIn.mockReturnValue(of(wireLoginTwoFactor()));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/google`)
        .send({ idToken: 'firebase-id-token' });

      expect(res.body.data.requiresTwoFactor).toBe(true);
      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[ACCESS_COOKIE]).toBeUndefined();
    });

    // ---------------------------------------------------------------- password

    it('22. forgot-password answers identically for a known and an unknown address', async () => {
      fx.stubs.auth.forgotPassword.mockReturnValue(of({}));

      const a = await anonymousAgent(fx.app)
        .post(`${API}/auth/password/forgot`)
        .send({ email: 'exists@forgot.test' });
      const b = await anonymousAgent(fx.app)
        .post(`${API}/auth/password/forgot`)
        .send({ email: 'nobody@forgot.test' });

      expect(a.status).toBe(b.status);
      expect(a.body.data).toEqual(b.body.data);
    });

    it('20. a wrong current password surfaces as 401, not 500', async () => {
      fx.stubs.auth.changePassword.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.UNAUTHENTICATED,
            'Current password is incorrect',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/auth/password`)
        .send({ currentPassword: 'Wrong1!', newPassword: 'BrandNew1!' }); // NOSONAR

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('a Google-only account gets 400, because FAILED_PRECONDITION maps there', async () => {
      // The mapping matters: a client that branches on 409 would treat this as a
      // conflict to retry rather than a state to explain.
      fx.stubs.auth.changePassword.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'This account has no password.',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/auth/password`)
        .send({ currentPassword: 'x', newPassword: 'BrandNew1!' }); // NOSONAR

      expect(res.status).toBe(400);
    });

    it('logout clears both session cookies', async () => {
      fx.stubs.auth.logout.mockReturnValue(of({ revokedSessionCount: 1 }));

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/auth/logout`)
        .set('Cookie', `${REFRESH_COOKIE}=some-refresh-token`);

      const cookies = parseSetCookie(res.headers['set-cookie']);
      expect(cookies[ACCESS_COOKIE].value).toBe('');
      expect(cookies[REFRESH_COOKIE].value).toBe('');
    });

    // ------------------------------------------------- TwoFactorEnrolmentGuard
  });

  describe('TwoFactorEnrolmentGuard', () => {
    it('2. a full session is admitted to setup and enable', async () => {
      fx.stubs.twoFactor.generateTwoFactor.mockReturnValue(
        of({
          otpauthUri: 'otpauth://totp/x',
          qrCodeDataUrl: 'data:,',
        }),
      );

      const res = await authenticatedAgent(fx.app).post(
        `${API}/auth/2fa/setup`,
      );

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('3. a mid-challenge caller is admitted to setup — the deadlock door', async () => {
      // The case the remaining-work doc flagged: a tenant turns on
      // `enforce_two_factor`, and a member with no secret gets a challenge
      // cookie and nothing else. Without this door they can neither
      // authenticate (no code exists) nor enrol (no full session) — a
      // permanent lockout with no self-service escape.
      fx.stubs.twoFactor.generateTwoFactor.mockReturnValue(
        of({
          otpauthUri: 'otpauth://totp/x',
          qrCodeDataUrl: 'data:,',
        }),
      );

      const res = await twoFactorChallengeAgent(fx.app).post(
        `${API}/auth/2fa/setup`,
      );

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(fx.stubs.twoFactor.generateTwoFactor).toHaveBeenCalled();
    });

    it('3b. the mid-challenge caller can complete enrolment too', async () => {
      fx.stubs.twoFactor.activateTwoFactor.mockReturnValue(
        of({ backupCodes: ['AAAA-1111'] }),
      );

      const res = await twoFactorChallengeAgent(fx.app)
        .post(`${API}/auth/2fa/enable`)
        .send({ code: '123456' });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('4. a caller with NEITHER cookie is refused', async () => {
      const setup = await anonymousAgent(fx.app).post(`${API}/auth/2fa/setup`);
      const enable = await anonymousAgent(fx.app)
        .post(`${API}/auth/2fa/enable`)
        .send({ code: '123456' });

      expect(setup.status).toBe(401);
      expect(enable.status).toBe(401);
    });

    it('a challenge cookie does NOT open an ordinary protected route', async () => {
      // The guard widens exactly two routes. If a challenge token satisfied
      // JwtAuthGuard generally, passing the password alone would be a complete
      // login.
      const res = await twoFactorChallengeAgent(fx.app).get(`${API}/users/me`);
      expect(res.status).toBe(401);
    });

    it('13. the backup-codes status never returns a code or a hash', async () => {
      fx.stubs.twoFactor.getBackupCodesStatus.mockReturnValue(
        of({ remaining: 8, used: 2, expiresAt: undefined }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/auth/2fa/backup-codes`,
      );

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/codeHash|backupCodes/);
      expect(
        Object.keys(res.body.data as Record<string, unknown>).sort(
          compareAlphabetically,
        ),
      ).toEqual(['expiresAt', 'remaining', 'used'].sort(compareAlphabetically));
    });
  });

  //  OTP

  describe('OTP at the boundary', () => {
    it('5. the status response carries a masked target and no hash', async () => {
      fx.stubs.otp.getOtpStatus.mockReturnValue(
        of({
          pending: true,
          target: 's*****c@example.test',
          attemptsRemaining: 4,
          expiresAt: undefined,
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/auth/otp/status?purpose=email_verification`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.target).toContain('*');
      expect(JSON.stringify(res.body)).not.toMatch(/codeHash/);
    });
  });

  // ----------------------------------------------------------- the envelope

  describe('the response envelope and ValidationPipe', () => {
    it('every success is wrapped in the success envelope', async () => {
      fx.stubs.auth.login.mockReturnValue(of(wireLoginSuccess(wireUser())));

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'envelope@login.test', password: 'Passw0rd!' });

      expect(res.body).toMatchObject({
        success: true,
        statusCode: 200,
        message: expect.any(String),
        data: expect.any(Object),
      });
    });

    it('every failure is wrapped in the error envelope', async () => {
      fx.stubs.auth.login.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAUTHENTICATED, 'nope')),
      );

      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'envelope-fail@login.test', password: 'Passw0rd!' });

      expect(res.body).toMatchObject({
        success: false,
        statusCode: 401,
        path: expect.any(String),
        timestamp: expect.any(String),
        error: expect.any(String),
      });
    });

    it('a malformed body is rejected by ValidationPipe before the service', async () => {
      const res = await anonymousAgent(fx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'not-an-email', password: '' });

      expect(res.status).toBe(400);
      expect(fx.stubs.auth.login).not.toHaveBeenCalled();
    });

    it('an unknown property is rejected — forbidNonWhitelisted', async () => {
      // The narrow-DTO guarantee: a client cannot smuggle a field the handler
      // never asked for and hope something downstream honours it.
      const res = await anonymousAgent(fx.app).post(`${API}/auth/login`).send({
        email: 'strict@login.test',
        password: 'Passw0rd!',
        isSuperAdmin: true,
      });

      expect(res.status).toBe(400);
    });
  });
});

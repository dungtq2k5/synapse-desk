import { of } from 'rxjs';
import {
  bootstrapE2eTest,
  E2eFixture,
  flushTestRedis,
} from '../utils/bootstrap';
import {
  ACCESS_COOKIE,
  anonymousAgent,
  API,
  authenticatedAgent,
  DEVICE_COOKIE,
  parseSetCookie,
  REFRESH_COOKIE,
  TENANT_SELECTION_COOKIE,
  twoFactorChallengeAgent,
  TWO_FA_COOKIE,
} from '../utils/auth';
import {
  wireLoginSuccess,
  wireLoginTenantSelection,
  wireLoginTwoFactor,
  wireUser,
} from '../fixtures/wire';

/**
 * the cookie sweep.
 *
 * Two properties, on every cookie the gateway sets, parametrized rather than
 * re-asserted per route:
 *
 *   1. **HttpOnly.** It is the entire reason the tokens live in cookies rather
 *      than in the body — an XSS on the page cannot read them. One cookie set
 *      without it undoes that for the whole session.
 *   2. **The body carries no raw token.** Setting an HttpOnly cookie and then
 *      echoing the same value into JSON hands it straight back to the script
 *      the flag was protecting it from.
 *
 * The fixtures use recognisable literal token values (`access-token-fixture`)
 * precisely so the second assertion can search for them: a UUID would be
 * indistinguishable from every other id in the response.
 */
type CookieProbe = {
  name: string;
  /** Cookies this response MUST set, with a non-empty value. */
  sets: string[];
  /** Cookies it must NOT set at all. */
  omits?: string[];
  /** Cookies it must CLEAR (set to an empty value). */
  clears?: string[];
  run: (fx: E2eFixture) => Promise<{
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }>;
};

describe('cookie sweep (e2e)', () => {
  let fx: E2eFixture;

  const PROBES: CookieProbe[] = [
    {
      name: 'POST /auth/login — clean success',
      sets: [ACCESS_COOKIE, REFRESH_COOKIE],
      omits: [TWO_FA_COOKIE, TENANT_SELECTION_COOKIE],
      run: async (f) => {
        f.stubs.auth.login.mockReturnValue(of(wireLoginSuccess()));
        return anonymousAgent(f.app)
          .post(`${API}/auth/login`)
          .send({ email: 'sweep-clean@cookies.test', password: 'Passw0rd!' });
      },
    },
    {
      name: 'POST /auth/login — tenant selection',
      sets: [TENANT_SELECTION_COOKIE],
      // Nothing is authorized yet: the password matched several accounts and
      // none has been chosen.
      omits: [ACCESS_COOKIE, REFRESH_COOKIE, TWO_FA_COOKIE],
      run: async (f) => {
        f.stubs.auth.login.mockReturnValue(of(wireLoginTenantSelection()));
        return anonymousAgent(f.app)
          .post(`${API}/auth/login`)
          .send({ email: 'sweep-multi@cookies.test', password: 'Passw0rd!' });
      },
    },
    {
      name: 'POST /auth/login — 2FA challenge',
      sets: [TWO_FA_COOKIE],
      omits: [ACCESS_COOKIE, REFRESH_COOKIE],
      run: async (f) => {
        f.stubs.auth.login.mockReturnValue(of(wireLoginTwoFactor()));
        return anonymousAgent(f.app)
          .post(`${API}/auth/login`)
          .send({ email: 'sweep-2fa@cookies.test', password: 'Passw0rd!' });
      },
    },
    {
      name: 'POST /auth/login/tenant',
      sets: [ACCESS_COOKIE, REFRESH_COOKIE],
      // The selection token named a set of accounts and one has now been
      // chosen — it is spent either way.
      clears: [TENANT_SELECTION_COOKIE],
      run: async (f) => {
        f.stubs.auth.loginWithTenant.mockReturnValue(of(wireLoginSuccess()));
        return anonymousAgent(f.app)
          .post(`${API}/auth/login/tenant`)
          .set('Cookie', `${TENANT_SELECTION_COOKIE}=opaque-token`)
          .send({ organizationId: '00000000-0000-4000-8000-000000000001' });
      },
    },
    {
      name: 'POST /auth/google',
      sets: [ACCESS_COOKIE, REFRESH_COOKIE],
      run: async (f) => {
        f.stubs.auth.googleSignIn.mockReturnValue(of(wireLoginSuccess()));
        return anonymousAgent(f.app)
          .post(`${API}/auth/google`)
          .send({ idToken: 'firebase-token' });
      },
    },
    {
      name: 'POST /auth/2fa/authenticate — with rememberDevice',
      sets: [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE],
      // The challenge is spent the moment the second factor lands.
      clears: [TWO_FA_COOKIE],
      run: async (f) => {
        f.stubs.twoFactor.authenticateTwoFactor.mockReturnValue(
          of({
            accessToken: 'access-token-fixture',
            refreshToken: 'refresh-token-fixture',
            deviceToken: 'device-token-fixture',
            user: wireUser(),
            warning: undefined,
          }),
        );
        return twoFactorChallengeAgent(f.app)
          .post(`${API}/auth/2fa/authenticate`)
          .send({ code: '123456', rememberDevice: true });
      },
    },
    {
      name: 'POST /auth/refresh',
      sets: [ACCESS_COOKIE, REFRESH_COOKIE],
      run: async (f) => {
        f.stubs.auth.refreshToken.mockReturnValue(
          of({
            accessToken: 'access-token-fixture',
            refreshToken: 'refresh-token-fixture',
            user: wireUser(),
          }),
        );
        return anonymousAgent(f.app)
          .post(`${API}/auth/refresh`)
          .set('Cookie', `${REFRESH_COOKIE}=some-refresh-token`);
      },
    },
    {
      name: 'POST /auth/logout',
      sets: [],
      clears: [ACCESS_COOKIE, REFRESH_COOKIE],
      run: async (f) => {
        f.stubs.auth.logout.mockReturnValue(of({ revokedSessionCount: 1 }));
        return authenticatedAgent(f.app)
          .post(`${API}/auth/logout`)
          .set('Cookie', `${REFRESH_COOKIE}=some-refresh-token`);
      },
    },
    {
      name: 'POST /auth/logout/all',
      sets: [],
      // The lost-laptop button must take the device cookie with it, or the
      // thief's next login still skips 2FA.
      clears: [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE],
      run: async (f) => {
        f.stubs.auth.logoutAll.mockReturnValue(of({ revokedSessionCount: 3 }));
        return authenticatedAgent(f.app).post(`${API}/auth/logout/all`);
      },
    },
    {
      name: 'POST /auth/password/reset',
      sets: [],
      // Every session died server-side; leaving the cookies would just produce
      // a 401 on the next request instead of a clean signed-out state.
      clears: [ACCESS_COOKIE, REFRESH_COOKIE],
      run: async (f) => {
        f.stubs.auth.resetPassword.mockReturnValue(
          of({ revokedSessionCount: 2 }),
        );
        return anonymousAgent(f.app)
          .post(`${API}/auth/password/reset`)
          .send({ token: 'reset-token', newPassword: 'BrandNewPass1!' });
      },
    },
  ];

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  const EXPECTED_SAME_SITE = (
    process.env.COOKIE_SAMESITE ?? 'lax'
  ).toLowerCase();

  /** Every literal token value the fixtures use, so the body can be searched. */
  const RAW_TOKENS = [
    'access-token-fixture',
    'refresh-token-fixture',
    'device-token-fixture',
    'two-factor-token-fixture',
    'tenant-selection-token-fixture',
  ];

  it('every cookie the gateway sets is HttpOnly with the configured SameSite', async () => {
    const wrong: string[] = [];

    for (const probe of PROBES) {
      const res = await probe.run(fx);
      const cookies = parseSetCookie(res.headers['set-cookie']);

      for (const name of probe.sets) {
        const cookie = cookies[name];
        if (!cookie || cookie.value === '') {
          wrong.push(`${probe.name}: ${name} was not set`);
          continue;
        }
        if (!cookie.httpOnly)
          wrong.push(`${probe.name}: ${name} is not HttpOnly`);
        if (cookie.sameSite !== EXPECTED_SAME_SITE) {
          wrong.push(
            `${probe.name}: ${name} SameSite=${cookie.sameSite}, expected ${EXPECTED_SAME_SITE}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('no response body EVER contains a raw token', async () => {
    // The other half of the HttpOnly guarantee. A cookie a script cannot read
    // is worth nothing if the same value is sitting in the JSON beside it.
    const leaked: string[] = [];

    for (const probe of PROBES) {
      const res = await probe.run(fx);
      const body = JSON.stringify(res.body);

      for (const token of RAW_TOKENS) {
        if (body.includes(token)) {
          leaked.push(`${probe.name}: body contains ${token}`);
        }
      }
      for (const key of ['accessToken', 'refreshToken', 'deviceToken']) {
        if (body.includes(`"${key}"`)) {
          leaked.push(`${probe.name}: body has a ${key} key`);
        }
      }
    }

    expect(leaked).toEqual([]);
  });

  it('each flow OMITS the cookies it must not set', async () => {
    // A 2FA challenge that also set an access cookie would be a complete login
    // handed out for a password alone.
    const wrong: string[] = [];

    for (const probe of PROBES) {
      if (!probe.omits) continue;
      const res = await probe.run(fx);
      const cookies = parseSetCookie(res.headers['set-cookie']);

      for (const name of probe.omits) {
        if (cookies[name] && cookies[name].value !== '') {
          wrong.push(`${probe.name}: set ${name}, which it must not`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('each flow CLEARS the cookies it spends', async () => {
    const wrong: string[] = [];

    for (const probe of PROBES) {
      if (!probe.clears) continue;
      const res = await probe.run(fx);
      const cookies = parseSetCookie(res.headers['set-cookie']);

      for (const name of probe.clears) {
        if (!cookies[name]) {
          wrong.push(`${probe.name}: never cleared ${name}`);
        } else if (cookies[name].value !== '') {
          wrong.push(
            `${probe.name}: ${name} left with a value instead of cleared`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('the device cookie outlives the access cookie — trust survives rotation', async () => {
    // 30 days against 15 minutes. If they shared a Max-Age, "remember this
    // device" would expire with the session it was granted on and the 2FA
    // prompt would return every quarter of an hour.
    fx.stubs.twoFactor.authenticateTwoFactor.mockReturnValue(
      of({
        accessToken: 'access-token-fixture',
        refreshToken: 'refresh-token-fixture',
        deviceToken: 'device-token-fixture',
        user: wireUser(),
        warning: undefined,
      }),
    );

    const res = await twoFactorChallengeAgent(fx.app)
      .post(`${API}/auth/2fa/authenticate`)
      .send({ code: '123456', rememberDevice: true });

    const cookies = parseSetCookie(res.headers['set-cookie']);
    expect(cookies[DEVICE_COOKIE].maxAge).toBeGreaterThan(
      cookies[ACCESS_COOKIE].maxAge!,
    );
  });

  it('rememberDevice=false sets NO device cookie', async () => {
    // The user declined. Issuing one anyway would silently opt them into a
    // 2FA bypass they explicitly refused.
    fx.stubs.twoFactor.authenticateTwoFactor.mockReturnValue(
      of({
        accessToken: 'access-token-fixture',
        refreshToken: 'refresh-token-fixture',
        deviceToken: undefined,
        user: wireUser(),
        warning: undefined,
      }),
    );

    const res = await twoFactorChallengeAgent(fx.app)
      .post(`${API}/auth/2fa/authenticate`)
      .send({ code: '123456', rememberDevice: false });

    const cookies = parseSetCookie(res.headers['set-cookie']);
    expect(cookies[DEVICE_COOKIE]?.value).toBeFalsy();
  });

  it('a cleared cookie carries the SAME attributes it was set with', async () => {
    // A browser only replaces a cookie when Path (and Domain) match. Clearing
    // with different attributes leaves the original in place and the "logout"
    // does nothing at all.
    fx.stubs.auth.login.mockReturnValue(of(wireLoginSuccess()));
    fx.stubs.auth.logout.mockReturnValue(of({ revokedSessionCount: 1 }));

    const login = await anonymousAgent(fx.app)
      .post(`${API}/auth/login`)
      .send({ email: 'sweep-path@cookies.test', password: 'Passw0rd!' });
    const logout = await authenticatedAgent(fx.app)
      .post(`${API}/auth/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=some-refresh-token`);

    const set = parseSetCookie(login.headers['set-cookie']);
    const cleared = parseSetCookie(logout.headers['set-cookie']);

    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(cleared[name].path).toBe(set[name].path);
      expect(cleared[name].sameSite).toBe(set[name].sameSite);
    }
  });
});

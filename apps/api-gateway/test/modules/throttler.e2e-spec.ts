import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
// Not re-exported from the package root, so imported from the internal path.
// The token is a plain string ('THROTTLER:MODULE_OPTIONS'); hardcoding it here
// instead would silently stop overriding anything if the library renamed it.
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AUTH_THROTTLER_TIER } from '../../src/common/config/throttler.config';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, wireLoginSuccess, wirePage } from '../fixtures/wire';

describe('SmartThrottlerGuard (e2e)', () => {
  let fx: E2eFixture;
  /**
   * the throttler.
   *
   * Runs at the e2e layer with the REAL `ThrottlerModule` and REAL Redis-backed
   * storage (DB 15, see .env.test). An in-memory stub would prove nothing:
   * whether the counter is keyed correctly, and whether it is shared across
   * replicas at all, is exactly what this suite is for.
   *
   * The general tiers are deliberately tightened here — `.env.test` leaves them
   * loose so no OTHER suite 429s itself halfway through — and `authTier` is left
   * as the app configures it, because every auth route overrides it with a
   * hardcoded per-route limit anyway (`ROUTE_THROTTLE.login` = 5 per 15 minutes).
   */
  const TIGHT_GENERAL_LIMIT = 3;

  beforeAll(async () => {
    await flushTestRedis();

    fx = await bootstrapE2eTest((builder) => {
      builder.overrideProvider(THROTTLER_OPTIONS).useValue({
        throttlers: [
          // Tight enough that a handful of requests trips it, so the test does
          // not have to issue hundreds.
          { name: 'short', ttl: 60_000, limit: TIGHT_GENERAL_LIMIT },
          { name: 'medium', ttl: 60_000, limit: 10_000 },
          { name: 'long', ttl: 60_000, limit: 10_000 },
          // Left generous: the routes under test override it per-route.
          { name: AUTH_THROTTLER_TIER, ttl: 900_000, limit: 10_000 },
        ],
        // The url overload, not a pre-built client: that is what makes the
        // storage own the connection and close it on shutdown, so the suite
        // exits instead of hanging on an open handle.
        storage: new ThrottlerStorageRedisService(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
        }),
      } satisfies ThrottlerModuleOptions);
    });
  });

  beforeEach(() => flushTestRedis());

  afterAll(() => fx.close());

  /** A login that would succeed if it reached the handler. */
  function stubSuccessfulLogin() {
    fx.stubs.auth.login.mockReturnValue(of(wireLoginSuccess()));
  }

  describe('tier routing', () => {
    it('1. an @AuthThrottle route ignores the general tiers entirely', async () => {
      // The general `short` tier is 3 here. Six logins for six DIFFERENT accounts
      // share one IP but not one account budget, so `authTier` never trips —
      // and if the general tier were also being evaluated, request four would
      // 429. It must not.
      stubSuccessfulLogin();

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await anonymousAgent(fx.app)
          .post(`${API}/auth/login`)
          .send({ email: `person${i}@tiers.test`, password: 'Passw0rd!' });
        statuses.push(res.status);
      }

      expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    });

    it('1b. a route WITHOUT @AuthThrottle does see the general tiers', async () => {
      // The other half of the same claim — otherwise test 1 could pass simply
      // because the tight tier was never applied to anything.
      fx.stubs.department.listDepartments.mockReturnValue(of(wirePage([])));

      const agent = authenticatedAgent(fx.app, {
        permissionCodes: ['department.read'],
      });

      const statuses: number[] = [];
      for (let i = 0; i < TIGHT_GENERAL_LIMIT + 2; i++) {
        statuses.push((await agent.get(`${API}/departments`)).status);
      }

      expect(statuses.slice(0, TIGHT_GENERAL_LIMIT)).not.toContain(429);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  describe('the 429 itself', () => {
    it('2. a 429 short-circuits BEFORE the handler — the gRPC call is never made', async () => {
      // If the guard ran after the handler, the rate limit would still cost a
      // round trip to auth-service on every rejected attempt, which is most of
      // what a limiter is meant to prevent.
      stubSuccessfulLogin();

      const email = 'victim@short-circuit.test';
      const send = () => postLogin(email);

      // ROUTE_THROTTLE.login allows 5 per 15 minutes per (ip, account).
      for (let i = 0; i < 5; i++) await send();

      const callsBefore = fx.stubs.auth.login.mock.calls.length;
      const blocked = await send();

      expect(blocked.status).toBe(429);
      expect(fx.stubs.auth.login.mock.calls.length).toBe(callsBefore);
    });

    it('2b. the 429 carries Retry-After and an actionable message', async () => {
      // The library default is the literal string "ThrottlerException: Too Many
      // Requests", which leaks a class name and tells a client nothing about
      // when to come back.
      stubSuccessfulLogin();

      const email = 'retry@header.test';
      const send = () => postLogin(email);

      for (let i = 0; i < 5; i++) await send();
      const blocked = await send();

      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.body.error).toMatch(/try again in/i);
      expect(blocked.body.error).not.toMatch(/ThrottlerException/);
    });
  });

  /** Posts a login for `email`. The four throttle cases all drive this route. */
  const postLogin = (email: string) =>
    anonymousAgent(fx.app)
      .post(`${API}/auth/login`)
      .send({ email, password: 'Passw0rd!' });

  describe('tracker keying', () => {
    it('3. two accounts from the SAME IP have independent budgets', async () => {
      // The NAT case. Keying anonymous auth routes on IP alone means five bad
      // passwords from one office lock every other employee out of signing in —
      // a self-inflicted outage dressed up as a security control.
      stubSuccessfulLogin();

      const post = postLogin;

      for (let i = 0; i < 5; i++) await post('alice@same-nat.test');
      expect((await post('alice@same-nat.test')).status).toBe(429);

      // Bob is behind the same IP and entirely unaffected.
      expect((await post('bob@same-nat.test')).status).not.toBe(429);
    });

    it('3b. capitalization does not buy a fresh budget', async () => {
      // Otherwise changing the case of one letter is a free reset of the
      // guessing limit.
      stubSuccessfulLogin();

      const post = postLogin;

      for (let i = 0; i < 5; i++) await post('carol@case.test');

      expect((await post('CAROL@case.test')).status).toBe(429);
    });

    it('3c. two different client IPs get independent buckets', async () => {
      // Proves the Redis key includes the IP rather than being one global
      // counter. `trust proxy` is set in the bootstrap, which is what makes
      // X-Forwarded-For become req.ip.
      stubSuccessfulLogin();

      const post = (ip: string) =>
        anonymousAgent(fx.app)
          .post(`${API}/auth/login`)
          .set('X-Forwarded-For', ip)
          .send({ email: 'shared@two-ips.test', password: 'Passw0rd!' });

      for (let i = 0; i < 5; i++) await post('203.0.113.10');
      expect((await post('203.0.113.10')).status).toBe(429);

      expect((await post('198.51.100.20')).status).not.toBe(429);
    });
  });

  describe('isolation between routes and users', () => {
    it('4. exhausting /auth/login does not touch an unrelated route', async () => {
      stubSuccessfulLogin();
      fx.stubs.department.listDepartments.mockReturnValue(of(wirePage([])));

      const email = 'busy@isolation.test';
      for (let i = 0; i < 6; i++) {
        await anonymousAgent(fx.app)
          .post(`${API}/auth/login`)
          .send({ email, password: 'Passw0rd!' });
      }

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['department.read'],
      }).get(`${API}/departments`);

      expect(res.status).not.toBe(429);
    });

    /**
     * WAS a `it.failing` known defect; FIXED in 16-doc §2.
     *
     * The defect: `SmartThrottlerGuard` is registered with `APP_GUARD`, and Nest
     * runs global guards BEFORE controller- and route-level ones — so
     * `JwtAuthGuard` had not run when the tracker was computed, `req.user` was
     * always undefined, and the documented per-user branch was unreachable.
     * Every authenticated route silently fell back to `ip:<ip>`, which is the
     * corporate-NAT problem the branch's own comment said it avoided.
     *
     * The fix could not be "read `req.user` harder": the guard now verifies the
     * access token itself, cookie-first then Bearer, with the same RS256 public
     * key `JwtStrategy` uses. Decoding without verifying would have been worse
     * than the IP fallback — anyone could forge a `sub` and mint a fresh bucket
     * per request, which is a rate limiter with a zero-cost bypass.
     *
     * It became urgent when the AI routes got limits: those cost real money per
     * request, and ten agents behind one office address sharing one budget is a
     * support ticket rather than a policy.
     */
    it('an authenticated route keys per USER, not per IP', async () => {
      fx.stubs.department.listDepartments.mockReturnValue(of(wirePage([])));

      const heavy = authenticatedAgent(fx.app, {
        permissionCodes: ['department.read'],
      });
      for (let i = 0; i < TIGHT_GENERAL_LIMIT + 1; i++) {
        await heavy.get(`${API}/departments`);
      }
      expect((await heavy.get(`${API}/departments`)).status).toBe(429);

      // A different user, same process, same address.
      const colleague = authenticatedAgent(fx.app, {
        permissionCodes: ['department.read'],
      });
      expect((await colleague.get(`${API}/departments`)).status).not.toBe(429);
    });

    it('the SAME user from two addresses shares ONE budget', async () => {
      // The other half of "keys per user", and the half that a per-IP tracker
      // passed by accident: an identity must not get a fresh budget by moving
      // between a laptop and a phone. Before the fix this test's expectation
      // was inverted and recorded as the CURRENT behaviour.
      fx.stubs.department.listDepartments.mockReturnValue(of(wirePage([])));

      const agent = authenticatedAgent(fx.app, {
        permissionCodes: ['department.read'],
      });

      for (let i = 0; i < TIGHT_GENERAL_LIMIT + 1; i++) {
        await agent
          .get(`${API}/departments`)
          .set('X-Forwarded-For', '10.0.0.1'); // NOSONAR
      }

      expect(
        (
          await agent.get(`${API}/departments`).set(
            'X-Forwarded-For',
            '10.0.0.2', // NOSONAR
          )
        ).status,
      ).toBe(429);
    });

    it('an ANONYMOUS route still keys per IP, because there is no identity', async () => {
      // The fallback the fix deliberately keeps. `/auth/login` has no caller
      // yet by definition, so IP plus submitted account is the only tracker
      // available — and it is the one the brute-force limit depends on.
      stubSuccessfulLogin();

      const login = (ip: string) =>
        anonymousAgent(fx.app)
          .post(`${API}/auth/login`)
          .set('X-Forwarded-For', ip)
          .send({ email: 'anon@isolation.test', password: 'Passw0rd!' });

      const exhausted = '10.0.1.1'; // NOSONAR

      for (let i = 0; i < 6; i++) await login(exhausted);
      expect((await login(exhausted)).status).toBe(429);

      // A different address is a different bucket — which is exactly why the
      // per-user tracker matters for the routes that DO have an identity.
      expect((await login('10.0.1.2')).status).not.toBe(429);
    });

    it('a failing gRPC call still consumes budget — a limiter is not a success meter', async () => {
      // Otherwise every wrong password is free, which is precisely the traffic
      // the login limit exists to stop.
      fx.stubs.auth.login.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAUTHENTICATED, 'Invalid credentials'),
        ),
      );

      const email = 'wrong@consumes.test';
      const post = () =>
        anonymousAgent(fx.app)
          .post(`${API}/auth/login`)
          .send({ email, password: 'Wrong!' });

      for (let i = 0; i < 5; i++) {
        expect((await post()).status).toBe(401);
      }
      expect((await post()).status).toBe(429);
    });
  });
});

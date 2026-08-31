import request from 'supertest';
import { API, E2eFixture, bootstrapE2eTest } from '../utils';

/**
 * The CORS policy, exercised with an `Origin` header.
 *
 * **Every other suite in this repository sends none.** `supertest` does not set
 * `Origin`, and the `cors` middleware short-circuits on a request without one —
 * so 867 e2e tests passed over a policy that refused the only client the system
 * has, and the one value that looked maximally permissive (`CORS = *`) produced
 * no `Access-Control-Allow-Origin` at all on HTTP while allowing every socket
 * handshake.
 *
 * That is the whole reason this file exists: the property has no expression
 * inside a harness that never sends the header the property is about.
 */
describe('CORS (e2e)', () => {
  let fx: E2eFixture;

  /** The first origin `.env.test` allows. */
  const ORIGIN = 'http://localhost:5173';

  // **Spelled out rather than imported from `cors.config`.** The first draft of
  // this file looped over `CORS_METHODS` / `CORS_ALLOWED_HEADERS` /
  // `CORS_EXPOSED_HEADERS`, and sabotage showed all three tests still green
  // after deleting `PUT`, `Idempotency-Key` and `X-RateLimit-Remaining` from
  // those arrays: a test that iterates the value it guards moves with it, so it
  // proves only that the middleware honours whatever it is handed.
  //
  // These lists are the CLIENT's requirement, which is the thing that does not
  // change when someone edits the config. The companion scan
  // (`cors-contract.spec.ts`) derives the same requirement from the route
  // decorators, so a newly routed method is caught there rather than by
  // remembering to extend this array.
  const REQUIRED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const REQUIRED_REQUEST_HEADERS = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Idempotency-Key',
    'x-apollo-operation-name',
    'apollo-require-preflight',
  ];
  const REQUIRED_RESPONSE_HEADERS = [
    'Retry-After',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ];

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  afterAll(async () => {
    await fx.close();
  });

  it('1. **Answers an allowed origin, and credentials with it**', async () => {
    // `credentials` is what the HttpOnly access-token cookie needs, and it is
    // also why the origin must be echoed rather than `*`: the spec forbids the
    // wildcard on a credentialed request, so `*` is unusable here rather than
    // permissive.
    const response = await request(fx.app.getHttpServer())
      .get(`${API}/health`)
      .set('Origin', ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('2. **Refuses an origin outside the list**', async () => {
    // Refusal is the ABSENCE of the header, not a status code — the request is
    // served and the browser discards the response. Asserting a 4xx here would
    // be asserting something `cors` never does.
    const response = await request(fx.app.getHttpServer())
      .get(`${API}/health`)
      .set('Origin', 'https://not-our-front-end.test');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('3. **Every method the gateway routes is allowed by the preflight**', async () => {
    // `PUT` was missing while four routes used it — the "replace the whole set"
    // writes for roles, permissions and department membership — so a front end
    // could not change who can do what. Asserted over the whole list rather
    // than over `PUT` alone, so the next method to be routed is covered by the
    // same test.
    for (const method of REQUIRED_METHODS) {
      const response = await request(fx.app.getHttpServer())
        .options(`${API}/users`)
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', method);

      const allowed = new Set(
        (response.headers['access-control-allow-methods'] ?? '')
          .split(',')
          .map((value: string) => value.trim()),
      );

      expect([method, allowed.has(method)]).toEqual([method, true]);
    }
  });

  it('4. **Every header a browser must send survives the preflight**', async () => {
    // `Idempotency-Key` failed quietly: the request succeeds without it because
    // the service derives a key, so the front end looked fine while the guard
    // it exists to provide was absent. Apollo's two fail loudly and in the
    // wrong place — a CORS error about a header the developer never knowingly
    // sent, which reads as GraphQL being broken.
    const response = await request(fx.app.getHttpServer())
      .options(`${API}/billing/plan`)
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        REQUIRED_REQUEST_HEADERS.join(','),
      );

    const allowed = new Set(
      (response.headers['access-control-allow-headers'] ?? '')
        .toLowerCase()
        .split(',')
        .map((value: string) => value.trim()),
    );

    for (const header of REQUIRED_REQUEST_HEADERS) {
      expect([header, allowed.has(header.toLowerCase())]).toEqual([
        header,
        true,
      ]);
    }
  });

  it('5. **The rate-limit headers are readable by the client**', async () => {
    // Four are written and none was readable. `Retry-After` is recovery;
    // `X-RateLimit-Remaining` is AVOIDANCE, and it is the only one that lets a
    // client slow down rather than discover the limit by hitting it.
    const response = await request(fx.app.getHttpServer())
      .get(`${API}/health`)
      .set('Origin', ORIGIN);

    const exposed = new Set(
      (response.headers['access-control-expose-headers'] ?? '')
        .toLowerCase()
        .split(',')
        .map((value: string) => value.trim()),
    );

    for (const header of REQUIRED_RESPONSE_HEADERS) {
      expect([header, exposed.has(header.toLowerCase())]).toEqual([
        header,
        true,
      ]);
    }
  });

  it('6. **A request with no Origin is untouched** — Stripe and the mail Worker', async () => {
    // Stripe's webhook and the mail Worker send no `Origin`, and with a LIST
    // origin `cors` short-circuits on that and adds nothing. Measured, not
    // assumed: with `origin: '*'` the same request comes back carrying
    // `Access-Control-Allow-Origin: *`, so this test does fail if the config
    // regresses to the wildcard.
    //
    // It is also why every other suite is blind to the policy: no `Origin` is
    // the shape all of them take.
    const response = await request(fx.app.getHttpServer()).get(`${API}/health`);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.status).toBeLessThan(500);
  });
});

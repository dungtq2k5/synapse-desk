/**
 * @file `http_requests_total` and `http_request_duration_seconds` on `/metrics`.
 *
 * - **Every request is counted once**, under the status the client received: one
 *   a handler served or threw from, and one a guard, the throttler, the lifecycle
 *   gate, validation, or a middleware or filter refused. So the series shows an
 *   error rate.
 * - **`route` is the path TEMPLATE** (`/api/v1/tickets/:id`), never the resolved
 *   path: one series per ticket otherwise, forever. A request with no template
 *   gets one of two fixed labels: `unmatched` (it matched no route, a 404) or
 *   `refused-before-routing` (a middleware or filter refused it first: origin,
 *   Content-Type, size; it may have targeted a real route).
 * - **Not counted:**
 *   - GraphQL: its errors ride inside a 200, so an HTTP-status series can't
 *     measure them, and counting the requests would read as a near-zero error
 *     rate;
 *   - CORS preflights: the browser asking permission, not a call to the API;
 *   - a request the client aborted: the Java gateway can't see one at its
 *     filter, and counting it on one gateway only would split the series.
 *
 * Every row measures a DELTA: the counter accumulates over the process, and "this
 * request moved exactly this series by exactly one" is two claims.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the HTTP metrics on /metrics', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const USER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const DEPARTMENT = 'cccccccc-1111-4111-8111-cccccccccccc';

  const headers = (
    permissionCodes: string[] = [],
    claims: Record<string, unknown> = {},
  ) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
        ...claims,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireDepartment = (id: string) => ({
    id,
    name: 'Support',
    description: 'Front line',
    memberCount: 3,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  type Counts = Record<string, number>;

  /** `route|method|status` -> value, for every sample of one series on one scrape. */
  const samplesOf = (body: string, series: string): Counts => {
    const counts: Counts = {};
    for (const line of body.split('\n')) {
      const match = new RegExp(`^${series}\\{([^}]*)\\}\\s+(\\S+)$`, 'u').exec(
        line,
      );
      if (!match) continue;
      const labels = Object.fromEntries(
        [...match[1].matchAll(/(\w+)="([^"]*)"/gu)].map(([, k, v]) => [k, v]),
      );
      counts[`${labels.route}|${labels.method}|${labels.status}`] = Number(
        match[2],
      );
    }

    return counts;
  };

  const scrape = async () => {
    const body = await (await fetch(`${gateway.metricsUrl}/metrics`)).text();

    return {
      body,
      requests: samplesOf(body, 'http_requests_total'),
      durations: samplesOf(body, 'http_request_duration_seconds_count'),
    };
  };

  const risen = (before: Counts, after: Counts): Counts =>
    Object.fromEntries(
      Object.entries(after)
        .map(([key, value]) => [key, value - (before[key] ?? 0)] as const)
        .filter(([, increase]) => increase > 0),
    );

  /** What one action moved: the counter, the histogram's count, and the whole body after. */
  const moved = async (action: () => Promise<unknown>) => {
    const before = await scrape();
    await action();
    const after = await scrape();

    return {
      requests: risen(before.requests, after.requests),
      durations: risen(before.durations, after.durations),
      body: after.body,
    };
  };

  const session = () => new Session(gateway.baseUrl);

  rowFor('Ops')(
    '**a request a handler serves is counted once, under its route, method and status — and the duration histogram counts it too**',
    async () => {
      const result = await moved(() =>
        fetch(`${gateway.baseUrl}/health/ready`),
      );

      expect(result.requests).toEqual({ '/health/ready|GET|200': 1 });
      // The same labels, so a latency panel and a traffic panel agree.
      expect(result.durations).toEqual({ '/health/ready|GET|200': 1 });
    },
  );

  rowFor('Ops')(
    '**the route label is the path TEMPLATE, never the resolved path — one series per ticket would degrade Prometheus before anyone noticed**',
    async () => {
      peers.auth
        .on('DepartmentService/GetDepartment')
        .reply(wireDepartment(DEPARTMENT));

      const result = await moved(async () => {
        const response = await session().get(
          `${API}/departments/${DEPARTMENT}`,
          headers(['department.read']),
        );
        expect(response.status).toBe(200);
      });

      expect(result.requests).toEqual({
        '/api/v1/departments/:id|GET|200': 1,
      });
      expect(result.body).not.toContain(DEPARTMENT);
    },
  );

  rowFor('Ops')('**a handler’s 201 is counted under 201**', async () => {
    peers.auth
      .on('DepartmentService/CreateDepartment')
      .reply(wireDepartment(DEPARTMENT));

    const result = await moved(async () => {
      const response = await session().post(
        `${API}/departments`,
        { name: 'Support' },
        headers(['department.create']),
      );
      expect(response.status).toBe(201);
    });

    expect(result.requests).toEqual({ '/api/v1/departments|POST|201': 1 });
    expect(result.durations).toEqual({ '/api/v1/departments|POST|201': 1 });
  });

  rowFor('Ops')(
    '**`status` is the status the client received — a handler’s 404, 503 and 500, and a failed validation, are each counted under their own**',
    async () => {
      const result = await moved(async () => {
        peers.auth
          .on('DepartmentService/GetDepartment')
          .fail(GrpcStatus.NOT_FOUND, 'No such department');
        expect(
          (
            await session().get(
              `${API}/departments/${DEPARTMENT}`,
              headers(['department.read']),
            )
          ).status,
        ).toBe(404);

        peers.auth
          .on('DepartmentService/GetDepartment')
          .fail(GrpcStatus.UNAVAILABLE, 'down');
        expect(
          (
            await session().get(
              `${API}/departments/${DEPARTMENT}`,
              headers(['department.read']),
            )
          ).status,
        ).toBe(503);

        peers.auth
          .on('DepartmentService/GetDepartment')
          .fail(GrpcStatus.INTERNAL, 'boom');
        expect(
          (
            await session().get(
              `${API}/departments/${DEPARTMENT}`,
              headers(['department.read']),
            )
          ).status,
        ).toBe(500);

        expect(
          (
            await session().post(
              `${API}/departments`,
              { nope: 1 },
              headers(['department.create']),
            )
          ).status,
        ).toBe(400);
      });

      expect(result.requests).toEqual({
        '/api/v1/departments/:id|GET|404': 1,
        '/api/v1/departments/:id|GET|503': 1,
        '/api/v1/departments/:id|GET|500': 1,
        '/api/v1/departments|POST|400': 1,
      });
      expect(result.durations).toEqual(result.requests);
    },
  );

  rowFor('Ops').each([
    [
      'no cookie at all (authentication)',
      '/api/v1/departments/:id|GET|401',
      () => session().get(`${API}/departments/${DEPARTMENT}`),
    ],
    [
      'no cookie on a route that checks authentication in its own handler (authentication, inline)',
      '/api/v1/users/me|GET|401',
      () => session().get(`${API}/users/me`),
    ],
    [
      'a caller without the permission (permissions)',
      '/api/v1/departments/:id|GET|403',
      () =>
        session().get(`${API}/departments/${DEPARTMENT}`, headers(['x.read'])),
    ],
    [
      'a caller who is not a Super Admin on a platform route (super admin)',
      '/api/v1/platform/jobs|GET|403',
      () => session().get(`${API}/platform/jobs`, headers([])),
    ],
    [
      'an unverified email on a route that sends mail (email verified)',
      '/api/v1/users/invitations|POST|403',
      () =>
        session().post(
          `${API}/users/invitations`,
          {
            invitations: [
              { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
            ],
          },
          headers(['user.invite'], { isEmailVerified: false }),
        ),
    ],
    [
      'a caller who is already logged in on a guest-only route (guest)',
      '/api/v1/auth/login|POST|400',
      () =>
        session().post(
          `${API}/auth/login`,
          {
            email: 'ada@example.com',
            password: 'correct horse battery staple',
          },
          headers([]),
        ),
    ],
    [
      'a frozen workspace (the lifecycle gate)',
      '/api/v1/departments/:id|GET|403',
      () => {
        peers.auth.on('OrganizationService/GetOrganizationStatus').always({
          status: toProtoOrgStatus(OrgStatus.FROZEN),
          deleted: false,
        });
        // A tenant no other row has cached, so the gate reads FROZEN.
        return session().get(
          `${API}/departments/${DEPARTMENT}`,
          headers(['department.read'], { organizationId: randomUUID() }),
        );
      },
    ],
    [
      'a request with no route behind it (a 404)',
      'unmatched|GET|404',
      () => session().get(`${API}/no/such/route`),
    ],
    [
      'a cross-origin write (origin, before routing)',
      'refused-before-routing|POST|403',
      () =>
        session().post(`${API}/auth/logout`, undefined, {
          origin: 'http://evil.example',
        }),
    ],
    [
      'a body that is not JSON (Content-Type, before routing)',
      'refused-before-routing|POST|415',
      () =>
        session().post(
          `${API}/departments`,
          { name: 'Support' },
          { ...headers(['department.create']), 'content-type': 'text/plain' },
        ),
    ],
    [
      'a report over the size cap (size, before routing)',
      'refused-before-routing|POST|413',
      () =>
        session().post(`${API}/client-errors`, {
          kind: 'error',
          message: 'too big',
          stack: 'x'.repeat(9 * 1024),
        }),
    ],
  ])(
    '**a refused request is counted once under its route and the refusal: %s**',
    async (_title, series, send) => {
      const expected = Number(series.split('|')[2]);
      const result = await moved(async () => {
        expect((await send()).status).toBe(expected);
      });

      expect(result.requests).toEqual({ [series]: 1 });
      expect(result.durations).toEqual({ [series]: 1 });
    },
  );

  rowFor('Ops')(
    '**the throttler’s refusal is counted under 429**',
    async () => {
      // Five logins per fifteen minutes per (ip, account); an account no other
      // row uses, so the bucket starts empty.
      const email = `metrics-${randomUUID()}@example.com`;
      const attempt = () =>
        session().post(`${API}/auth/login`, { email, password: 'whatever' });
      peers.auth.on('AuthService/Login').always({
        requiresTwoFactor: true,
        requiresTenantSelection: false,
        tenants: [],
      });
      for (let index = 0; index < 5; index++) {
        expect((await attempt()).status).not.toBe(429);
      }

      const result = await moved(async () => {
        expect((await attempt()).status).toBe(429);
      });

      expect(result.requests).toEqual({ '/api/v1/auth/login|POST|429': 1 });
      expect(result.durations).toEqual({ '/api/v1/auth/login|POST|429': 1 });
    },
  );

  rowFor('Ops')(
    '**a CORS preflight and a GraphQL request are not counted**',
    async () => {
      const result = await moved(async () => {
        await session().request('OPTIONS', `${API}/auth/login`, {
          headers: {
            origin: 'http://localhost:5173',
            'access-control-request-method': 'POST',
          },
        });
        const graphql = await session().post(
          '/graphql',
          { query: '{ __typename }' },
          headers([]),
        );
        expect(graphql.status).toBe(200);
      });

      expect(result.requests).toEqual({});
      expect(result.durations).toEqual({});
    },
  );

  rowFor('Ops')(
    '**a handler’s OWN refusal is counted — a wrong password is a request the handler served**',
    async () => {
      peers.auth
        .on('AuthService/Login')
        .fail(GrpcStatus.UNAUTHENTICATED, 'Invalid credentials');

      const result = await moved(async () => {
        const response = await session().post(`${API}/auth/login`, {
          email: 'ada@example.com',
          password: 'wrong',
        });
        expect(response.status).toBe(401);
      });

      expect(result.requests).toEqual({ '/api/v1/auth/login|POST|401': 1 });
      expect(result.durations).toEqual({ '/api/v1/auth/login|POST|401': 1 });
    },
  );
});

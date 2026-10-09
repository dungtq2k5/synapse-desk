/**
 * @file `http_requests_total` and `http_request_duration_seconds` on `/metrics`.
 *
 * Both are read by alert rules and dashboards, so what is pinned here is what the
 * gateway DOES, including the parts that look like defects: "improving" any of them
 * would step the series by exactly the volume of the difference, which reads as a
 * traffic event and not as a change of meaning.
 *
 * - **Counted only once a request reaches a handler.** The recorder runs after the
 *   guards, so a request a guard refuses, a request that matches no route and a
 *   preflight are not counted. A handler's OWN refusal is.
 * - **`status` is the route's DECLARED success status, never the outcome.** The
 *   recorder reads the status before an error response sets the real one, so a
 *   request the client sees as 404, 503 or 400 is
 *   counted as 200 (a GET) or 201 (a POST). The label cannot show an error rate;
 *   whether it SHOULD is a separate metrics decision, made deliberately with the
 *   dashboards updated in the same change.
 * - **`route` is the path TEMPLATE**, as Express writes it (`/api/v1/tickets/:id`),
 *   never the resolved path: one series per ticket otherwise, forever.
 *
 * Every row measures a DELTA: the counter accumulates over the process, and "this
 * request moved exactly this series by exactly one" is two claims.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
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
      samples: Object.keys(after.requests),
    };
  };

  const session = () => new Session(gateway.baseUrl);

  rowFor('Ops')(
    '**a request that reaches a handler is counted once, under its route, method and status — and the duration histogram counts it too**',
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

  rowFor('Ops')(
    '**`status` is the DECLARED success status, never the outcome — a 404, a 503 and a failed validation are all counted as the route’s success status**',
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
        '/api/v1/departments/:id|GET|200': 2,
        '/api/v1/departments|POST|201': 1,
      });
      // No series carries an outcome status: that is the whole point of the row.
      expect(result.samples.some((key) => /\|(400|404|503)$/u.test(key))).toBe(
        false,
      );
    },
  );

  rowFor('Ops').each([
    [
      'no cookie at all (authentication)',
      401,
      () => session().get(`${API}/departments/${DEPARTMENT}`),
    ],
    [
      'no cookie on a route that checks authentication in its own handler (authentication, inline)',
      401,
      () => session().get(`${API}/users/me`),
    ],
    [
      'a caller without the permission (permissions)',
      403,
      () =>
        session().get(`${API}/departments/${DEPARTMENT}`, headers(['x.read'])),
    ],
    [
      'a caller who is not a Super Admin on a platform route (super admin)',
      403,
      () => session().get(`${API}/platform/jobs`, headers([])),
    ],
    [
      'an unverified email on a route that sends mail (email verified)',
      403,
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
      400,
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
      'a path that matches no route',
      404,
      () => session().get(`${API}/no/such/route`),
    ],
  ])(
    '**a request refused before its handler is NOT counted: %s — so the series steps by no refused request at cutover**',
    async (_title, expected, send) => {
      const result = await moved(async () => {
        expect((await send()).status).toBe(expected);
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

      // `@HttpCode(200)` is login's declared status, whatever the client saw.
      expect(result.requests).toEqual({ '/api/v1/auth/login|POST|200': 1 });
    },
  );
});

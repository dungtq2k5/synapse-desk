/**
 * @file `http_requests_total` and `http_request_duration_seconds` on `/metrics`.
 *
 * - **Every request matched to a route is counted**, refused or not: a guard's
 *   refusal is counted like a handler's own. A request that matches no route and a
 *   preflight are not.
 * - **`status` is the status the client received**, so the series shows an error
 *   rate.
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
    '**`status` is the status the client received — a 404, a 503 and a failed validation are each counted under their own**',
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
        '/api/v1/departments/:id|GET|404': 1,
        '/api/v1/departments/:id|GET|503': 1,
        '/api/v1/departments|POST|400': 1,
      });
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
  ])(
    '**a request a guard refuses is counted under its route and the refusal: %s**',
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
    '**a path that matches no route is not counted — a scanner’s guesses would mint one series each**',
    async () => {
      const result = await moved(async () => {
        expect((await session().get(`${API}/no/such/route`)).status).toBe(404);
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
    },
  );
});

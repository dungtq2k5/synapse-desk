/**
 * @file The error envelope, the guards, CORS, rate limiting, and the ops surface.
 *
 * Every row asserts the WHOLE envelope or the whole header set rather than a
 * status: the shape is the contract, and a Java gateway that answered 404 with
 * a different body would pass a status-only assertion while breaking every
 * client. Three rows pin behaviour this repository fixed only days ago —
 * a transport failure's fixed message (gap 38), the per-tier
 * `Access-Control-Expose-Headers` (gap 39) and `/metrics`' `scheduled_job`
 * label (gap 37) — so the harness records the fixed behaviour, not the bug.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus, SCHEDULED_JOBS } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the error envelope and the edges around it', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '33333333-3333-4333-8333-333333333333';
  const USER = '44444444-4444-4444-8444-444444444444';
  const ORIGIN = 'http://localhost:5173';

  const tokenWith = (permissionCodes: string[]) =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const as = (permissionCodes: string[]) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${tokenWith(permissionCodes)}`,
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

  // ------------------------------------------------------------- the envelope

  rowFor('Ops')(
    '**an unknown route** answers the envelope, inside and outside the prefix',
    async () => {
      const session = new Session(gateway.baseUrl);

      for (const path of [`${API}/does-not-exist`, '/does-not-exist']) {
        const response = await session.get(path);

        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
          success: false,
          statusCode: 404,
          path,
          error: `Cannot GET ${path}!`,
        });
        expect(response.body).toHaveProperty('timestamp');
      }
    },
  );

  rowFor('Auth')(
    '**a DTO validation failure** joins its messages with `, ` and ends with `!`',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/login`,
        { email: 'not-an-email', password: 5, extra: true },
      );

      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe(
        'property extra should not exist, email must be an email, password must be a string!',
      );
    },
  );

  rowFor('Users')(
    '**a mapped gRPC error** keeps the service’s own text',
    async () => {
      peers.auth
        .on('UserService/GetCurrentUser')
        .fail(GrpcStatus.NOT_FOUND, 'No such user');

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/me`,
        as([]),
      );

      expect(response.status).toBe(404);
      expect((response.body as { error: string }).error).toBe('No such user!');
    },
  );

  rowFor('Users')(
    '**an unmarked transport failure** answers the fixed message, with no address',
    async () => {
      // Gap 38: grpc-js generates `UNAVAILABLE` itself when a peer is down, and
      // its details name the address. Only text a service MARKED is forwarded.
      peers.auth
        .on('UserService/GetCurrentUser')
        .fail(
          GrpcStatus.UNAVAILABLE,
          'No connection established. Last error: connect ECONNREFUSED 10.0.3.7:50051',
        );

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/me`,
        as([]),
      );

      expect(response.status).toBe(503);
      expect((response.body as { error: string }).error).toBe(
        'A service this request depends on is unavailable. Try again shortly!',
      );
      expect(response.text).not.toMatch(/ECONNREFUSED|10\.0\.3\.7|50051/u);
    },
  );

  // ---------------------------------------------------------------- the guards

  rowFor('Billing')(
    '**a permission guard** refuses with 403 before the peer is called',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/billing/subscription`,
        as([]),
      );

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ success: false, statusCode: 403 });
      expect(peers.auth.calls('BillingService/GetSubscription')).toHaveLength(
        0,
      );
    },
  );

  rowFor('Billing')(
    '…and admits the same request when the token carries the code',
    async () => {
      peers.auth.on('BillingService/GetSubscription').reply({
        planName: 'Pro',
        maxAgentSeats: 25,
        maxStorageBytes: 100,
        monthlyAiTokenBudget: 100,
        aiModelTier: 1,
        billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
        status: toProtoOrgStatus(OrgStatus.ACTIVE),
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/billing/subscription`,
        as(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(peers.auth.calls('BillingService/GetSubscription')).toHaveLength(
        1,
      );
    },
  );

  // ------------------------------------------------------------------ the wire

  rowFor('Ops')(
    '**CORS exposes every rate-limit header the gateway actually sends** (gap 39)',
    async () => {
      const response = await new Session(gateway.baseUrl).get('/health', {
        origin: ORIGIN,
      });

      const exposed = new Set(
        (response.headers.get('access-control-expose-headers') ?? '')
          .toLowerCase()
          .split(',')
          .map((value) => value.trim()),
      );
      // FIXME Property 'keys' does not exist on type 'Headers'.
      const sent = [...response.headers.keys()].filter((name) =>
        /^(x-ratelimit-|retry-after)/u.test(name),
      );

      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter((name) => !exposed.has(name))).toEqual([]);
      expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(response.headers.get('access-control-allow-credentials')).toBe(
        'true',
      );
    },
  );

  rowFor('Auth')(
    'a preflight from an origin outside the list is refused',
    async () => {
      const allowed = await new Session(gateway.baseUrl).request(
        'OPTIONS',
        `${API}/auth/login`,
        {
          headers: {
            origin: ORIGIN,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
        },
      );
      const refused = await new Session(gateway.baseUrl).request(
        'OPTIONS',
        `${API}/auth/login`,
        {
          headers: {
            origin: 'http://evil.example',
            'access-control-request-method': 'POST',
          },
        },
      );

      expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    },
  );

  rowFor('Ops')('the helmet header set is on every response', async () => {
    const response = await new Session(gateway.baseUrl).get('/health');

    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('strict-transport-security')).toContain(
      'max-age=31536000',
    );
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
  });

  rowFor('Auth')(
    '**the login tier refuses the sixth attempt** with `Retry-After`',
    async () => {
      // Five per fifteen minutes per (ip, account). This run's Redis is its own,
      // so the bucket starts empty and the row does not depend on what ran before.
      const session = new Session(gateway.baseUrl);
      const attempt = () =>
        session.post(`${API}/auth/login`, {
          email: 'rate@example.com',
          password: 'whatever',
        });

      peers.auth.on('AuthService/Login').always({
        requiresTwoFactor: true,
        requiresTenantSelection: false,
        tenants: [],
      });

      const statuses: number[] = [];
      for (let index = 0; index < 6; index++) {
        statuses.push((await attempt()).status);
      }
      const refused = await attempt();

      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('900');
      expect(refused.headers.get('retry-after-authtier')).toBe('900');
      expect((refused.body as { error: string }).error).toBe(
        'Too many requests. Try again in 15 minutes!',
      );
      expect(statuses.filter((code) => code === 429)).toHaveLength(1);
    },
  );

  // ------------------------------------------------------------------- the ops

  rowFor('Ops')(
    '**`/metrics` exports the job gauge with `scheduled_job`** (gap 37)',
    async () => {
      const succeededAt = { seconds: 1_756_684_800, nanos: 0 };
      peers.ticket.on('AnalyticsService/GetJobHealth').always({
        items: [
          {
            jobName: SCHEDULED_JOBS.ANALYTICS_DAILY,
            lastSucceededAt: succeededAt,
            consecutiveFailures: 0,
          },
        ],
      });
      peers.ingestion
        .on('AiLedgerService/GetAiJobHealth')
        .always({ items: [] });
      peers.auth.on('PlatformService/GetAuthJobHealth').always({ items: [] });

      const response = await fetch(`${gateway.metricsUrl}/metrics`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('http_requests_total');
      expect(body).toContain(
        `job_last_success_timestamp_seconds{scheduled_job="${SCHEDULED_JOBS.ANALYTICS_DAILY}"`,
      );
      expect(body).toContain('owner_service=');
      // The label Prometheus attaches itself must not be declared by the metric.
      expect(body).not.toMatch(/job_last_success_timestamp_seconds\{job=/u);
    },
  );
});

/**
 * @file The tenant lifecycle gate: what a frozen, suspended, closed or onboarding
 * workspace may do, and the call that decides it.
 *
 * Without the gate, setting a tenant to FROZEN changes a column and nothing else:
 * billing suspension, offboarding and freezing all become advisory, and the tenant
 * keeps working. It fails SILENTLY, which is why it hid: thirty-five other rows
 * program a `GetOrganizationStatus` answer and none asserts the call happened, so a
 * gateway that never asks passes every one of them.
 *
 * **So every row's FIRST claim is that the peer was asked** (or, for an exempt
 * request, that it was not), and the refusal is the second claim. A gateway that
 * skips the call and answers 403 for some other reason, or skips it and lets
 * everything through, fails here for the right reason.
 *
 * What is pinned is what the gateway DOES: the access table, the category each route
 * resolves to, the three requests that are never gated, the thirty-second cache in
 * Redis under `org-status:<id>` (shared by every replica, so the value is read by
 * whichever replica asks next), failing CLOSED, and that a platform change
 * invalidates the cached decision. The category of EVERY route is held by the table
 * `org-access-routes.json`; these rows prove the behaviour end to end.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { ORG_STATUS_ACCESS, OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the tenant lifecycle gate', () => {
  let gateway: Gateway;
  let peers: Peers;
  let redis: Redis;

  // Unique to this suite: it writes FROZEN and DELETED into the status cache in the
  // shared Redis, and another suite using the same id would be refused by it.
  const ORGANIZATION = 'a0470000-0000-4000-8000-000000000047';
  const USER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const DEPARTMENT = 'cccccccc-1111-4111-8111-cccccccccccc';
  const CACHE_KEY = `org-status:${ORGANIZATION}`;
  const STATUS_RPC = 'OrganizationService/GetOrganizationStatus';

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

  const superAdminHeaders = () =>
    headers([], {
      sub: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
      organizationId: null,
      isSuperAdmin: true,
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
    redis = new Redis(redisUrl);
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
    redis.disconnect();
  });

  beforeEach(async () => {
    peers.reset();
    // The decision is cached for thirty seconds, in a store the rows share.
    await redis.del(CACHE_KEY);
  });

  const tenantIs = (status: OrgStatus, deleted = false) =>
    peers.auth
      .on(STATUS_RPC)
      .always({ status: toProtoOrgStatus(status), deleted });

  const statusCalls = () => peers.auth.calls(STATUS_RPC);

  const session = () => new Session(gateway.baseUrl);

  /** One route per category, with the peer call its handler would make. */
  const ROUTES: Record<
    string,
    {
      send: () => Promise<{ status: number; body: unknown }>;
      downstream: string;
    }
  > = {
    READ: {
      send: () =>
        session().get(
          `${API}/departments/${DEPARTMENT}`,
          headers(['department.read']),
        ),
      downstream: 'DepartmentService/GetDepartment',
    },
    WRITE: {
      send: () =>
        session().post(
          `${API}/departments`,
          { name: 'Support', description: 'Front line' },
          headers(['department.create']),
        ),
      downstream: 'DepartmentService/CreateDepartment',
    },
    BILLING: {
      send: () =>
        session().get(
          `${API}/billing/subscription`,
          headers(['organization.read']),
        ),
      downstream: 'BillingService/GetSubscription',
    },
    ONBOARDING: {
      send: () =>
        session().get(
          `${API}/organizations/current/onboarding`,
          headers(['organization.read']),
        ),
      downstream: 'OrganizationService/GetOnboarding',
    },
    AUTH: {
      send: () => session().get(`${API}/users/me`, headers([])),
      downstream: 'UserService/GetCurrentUser',
    },
  };

  const downstreamCalls = (kind: string) =>
    peers.auth.calls(ROUTES[kind].downstream);

  /** What the gate says, by status: the text a person is shown. */
  const REFUSAL: Record<string, string> = {
    SUSPENDED_PAST_DUE:
      'This workspace is suspended for non-payment. It is read-only until billing is settled.',
    FROZEN: 'This workspace is frozen. Contact support to restore access.',
    CLOSED:
      'This workspace has been closed. Contact support if this is unexpected.',
  };

  /** The envelope writes a message's closing period as `!`. */
  const enveloped = (message: string): string =>
    `${message.replace(/\.$/u, '')}!`;

  const errorOf = (body: unknown): string =>
    (body as { error?: string }).error ?? '';

  const lifecycleRefusal = (status: number, body: unknown): boolean =>
    status === 403 && /workspace/u.test(errorOf(body));

  // ---------------------------------------------------- the matrix, one row per cell

  const MATRIX = (
    [
      OrgStatus.ACTIVE,
      OrgStatus.PENDING_ONBOARDING,
      OrgStatus.SUSPENDED_PAST_DUE,
      OrgStatus.FROZEN,
    ] as OrgStatus[]
  ).flatMap((status) =>
    Object.keys(ROUTES).map(
      (kind) =>
        [
          status,
          kind,
          (ORG_STATUS_ACCESS[status] as readonly string[]).includes(kind),
        ] as const,
    ),
  );

  rowFor('Ops').each(MATRIX)(
    '**a %s workspace and a %s route: the gate asks, and answers allowed=%s**',
    async (status, kind, allowed) => {
      tenantIs(status);

      const response = await ROUTES[kind].send();

      // The first claim: the decision was MADE, by asking, except where the route
      // is exempt by category and is never asked about.
      expect(statusCalls()).toHaveLength(kind === 'AUTH' ? 0 : 1);
      if (kind !== 'AUTH') {
        expect(statusCalls()[0].request).toMatchObject({
          organizationId: ORGANIZATION,
        });
      }

      if (allowed) {
        expect(lifecycleRefusal(response.status, response.body)).toBe(false);
        // The request went on to its handler.
        expect(downstreamCalls(kind).length).toBeGreaterThanOrEqual(1);
      } else {
        expect(response.status).toBe(403);
        expect(errorOf(response.body)).toBe(enveloped(REFUSAL[status]));
        // The status as data, so a client never reads the sentence.
        expect((response.body as { details?: unknown }).details).toEqual({
          organizationStatus: status,
        });
        // And never reached it.
        expect(downstreamCalls(kind)).toHaveLength(0);
      }
    },
  );

  // ------------------------------------------------------------------ closed

  rowFor('Ops').each(Object.keys(ROUTES))(
    '**a closed workspace on a %s route**',
    async (kind) => {
      // Deleted is distinct from any status: refused even though it still reads ACTIVE.
      tenantIs(OrgStatus.ACTIVE, true);

      const response = await ROUTES[kind].send();

      if (kind === 'AUTH') {
        // Sign-in routes pass so a member can be TOLD why they cannot proceed.
        expect(statusCalls()).toHaveLength(0);
        expect(lifecycleRefusal(response.status, response.body)).toBe(false);

        return;
      }
      expect(statusCalls()).toHaveLength(1);
      expect(response.status).toBe(403);
      expect(errorOf(response.body)).toBe(enveloped(REFUSAL.CLOSED));
      // A closed workspace has no status to report; only a status refusal does.
      expect(response.body).not.toHaveProperty('details');
      expect(downstreamCalls(kind)).toHaveLength(0);
    },
  );

  // -------------------------------------------------------------- the question

  rowFor('Ops')(
    '**the gate asks about THIS tenant, by id, with no caller identity — the id came from a token the gateway just verified**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);

      await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(1);
      const [call] = statusCalls();
      expect(call.request).toMatchObject({ organizationId: ORGANIZATION });
      // The RPC is by id and unscoped: no user, no tenant on the wire.
      expect(call.metadata.user_id).toBeUndefined();
      expect(call.metadata.organization_id).toBeUndefined();
      // And an EMPTY origin, not the caller's: nothing about who asked is sent.
      expect(call.metadata.ip_address ?? '').toBe('');
      expect(call.metadata.user_agent ?? '').toBe('');
    },
  );

  // ------------------------------------------------------------------ the order

  rowFor('Ops')(
    '**the gate runs AFTER the permission check — a member who lacks the permission is refused for THAT, and the gate never asks about the tenant**',
    async () => {
      tenantIs(OrgStatus.FROZEN);

      const response = await session().get(
        `${API}/departments/${DEPARTMENT}`,
        headers(['some.other.permission']),
      );

      expect(response.status).toBe(403);
      // The permission's refusal, not the workspace's.
      expect(errorOf(response.body)).not.toMatch(/workspace/u);
      expect(statusCalls()).toHaveLength(0);
    },
  );

  // ---------------------------------------------------------------- exemptions

  rowFor('Ops').each([
    [
      'a request with no session (no tenant yet)',
      () => session().get(`${API}/departments/${DEPARTMENT}`),
      401,
    ],
    [
      'a Super Admin, who belongs to no tenant and acts ON frozen ones',
      () =>
        session().get(`${API}/departments/${DEPARTMENT}`, superAdminHeaders()),
      undefined,
    ],
    [
      'a route Node never authenticates, even for a frozen tenant’s member (health)',
      () => session().get('/health/ready', headers([])),
      200,
    ],
  ])(
    '**never asked about, never gated: %s**',
    async (_title, send, expected) => {
      tenantIs(OrgStatus.FROZEN);

      const response = await send();

      expect(statusCalls()).toHaveLength(0);
      expect(lifecycleRefusal(response.status, response.body)).toBe(false);
      if (expected !== undefined) expect(response.status).toBe(expected);
    },
  );

  // --------------------------------------------------------------------- cache

  rowFor('Ops')(
    '**a decision is cached for thirty seconds in Redis under `org-status:<id>` — two requests, one question**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);

      await ROUTES.READ.send();
      await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(1);
      expect(JSON.parse((await redis.get(CACHE_KEY)) ?? 'null')).toEqual({
        status: 'ACTIVE',
        deleted: false,
      });
      const ttl = await redis.ttl(CACHE_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    },
  );

  rowFor('Ops')(
    '**a decision another replica cached is honoured without asking — the freeze is cluster-wide, in the same shape**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);
      await redis.set(
        CACHE_KEY,
        JSON.stringify({ status: 'FROZEN', deleted: false }),
        'EX',
        30,
      );

      const response = await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(0);
      expect(response.status).toBe(403);
      expect(errorOf(response.body)).toBe(enveloped(REFUSAL.FROZEN));
    },
  );

  rowFor('Ops')(
    '**a cached value that cannot be read is a miss, not an error — the gate asks and carries on**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);
      await redis.set(CACHE_KEY, 'not json at all', 'EX', 30);

      const response = await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(1);
      expect(lifecycleRefusal(response.status, response.body)).toBe(false);
    },
  );

  // ----------------------------------------------------------- failing closed

  rowFor('Ops')(
    '**a status the peer could not read (UNSPECIFIED) is treated as FROZEN — caching "usable" for a tenant whose state is unknown would gate nothing**',
    async () => {
      peers.auth.on(STATUS_RPC).always({ status: 0, deleted: false });

      const response = await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(1);
      expect(response.status).toBe(403);
      expect(errorOf(response.body)).toBe(enveloped(REFUSAL.FROZEN));
      expect(downstreamCalls('READ')).toHaveLength(0);
    },
  );

  rowFor('Ops')(
    '**a peer that cannot be reached fails the request — it does not wave it through**',
    async () => {
      peers.auth.on(STATUS_RPC).fail(GrpcStatus.UNAVAILABLE, 'auth is down');

      const response = await ROUTES.READ.send();

      expect(statusCalls()).toHaveLength(1);
      expect(response.status).toBe(503);
      expect(downstreamCalls('READ')).toHaveLength(0);
    },
  );

  // ------------------------------------------------------------- invalidation

  rowFor('Ops')(
    '**a platform status change drops the cached decision at once — a freeze must not wait out the thirty seconds**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);
      await ROUTES.READ.send();
      expect(await redis.exists(CACHE_KEY)).toBe(1);

      peers.auth.on('PlatformService/SetOrganizationStatus').reply({
        organization: {
          id: ORGANIZATION,
          name: 'Acme',
          slug: 'acme',
          status: 'ORG_STATUS_FROZEN',
          enforceTwoFactor: false,
          allowedEmailDomains: [],
          maxAgentSeats: 5,
          maxStorageBytes: '1000000',
          monthlyAiTokenBudget: '1000000',
          billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
          updatedAt: { seconds: 1_756_684_800, nanos: 0 },
        },
        userCount: 3,
        pendingInvitationCount: 0,
        departmentCount: 1,
      });
      const changed = await session().post(
        `${API}/platform/organizations/${ORGANIZATION}/status`,
        { status: 'FROZEN', reason: 'suspected fraud' },
        superAdminHeaders(),
      );

      expect(changed.status).toBe(200);
      expect(await redis.exists(CACHE_KEY)).toBe(0);
    },
  );

  // ------------------------------------------------------------------ GraphQL

  const departmentsQuery = () =>
    session().post<{ errors?: { message: string }[]; data?: unknown }>(
      '/graphql',
      {
        query:
          '{ departments(first: 10, page: 1) { items { id name } meta { totalItems } } }',
      },
      headers(['department.read']),
    );

  rowFor('Ops')(
    '**the gate covers GraphQL too — a frozen workspace that can still read through GraphQL is a suspension with a hole in it**',
    async () => {
      tenantIs(OrgStatus.FROZEN);
      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [wireDepartment(DEPARTMENT)],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await departmentsQuery();

      expect(statusCalls()).toHaveLength(1);
      // The text and the category; how each gateway spells the error's punctuation and
      // its `extensions` key is how it formats EVERY GraphQL error, not this gate's.
      const body = JSON.stringify(response.body);
      expect(body).toContain(REFUSAL.FROZEN.replace(/\.$/u, ''));
      expect(body).toContain('FORBIDDEN');
      expect(
        peers.auth.calls('DepartmentService/ListDepartments'),
      ).toHaveLength(0);
    },
  );

  rowFor('Ops')(
    '**and GraphQL is allowed for an active workspace, after the same question**',
    async () => {
      tenantIs(OrgStatus.ACTIVE);
      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [wireDepartment(DEPARTMENT)],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await departmentsQuery();

      expect(statusCalls()).toHaveLength(1);
      expect(response.body).not.toHaveProperty('errors');
      expect(
        peers.auth.calls('DepartmentService/ListDepartments'),
      ).toHaveLength(1);
    },
  );

  rowFor('Ops')(
    '**the one public GraphQL query stays open for a frozen workspace’s member, and is never asked about — Node’s JwtAuthGuard does not run on it**',
    async () => {
      tenantIs(OrgStatus.FROZEN);

      const response = await session().post<{
        data?: unknown;
        errors?: unknown;
      }>('/graphql', { query: '{ version { version } }' }, headers([]));

      expect(statusCalls()).toHaveLength(0);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body).toHaveProperty('data.version.version');
    },
  );

  rowFor('Platform')(
    '**a tenant admin on a super-admin-only route is refused by THAT door, and the gate never asks about the tenant**',
    async () => {
      // A tenant the cache has not seen, whose status the peer could not even
      // answer: were the gate asked first, the answer would be its refusal or a
      // peer failure, not the super-admin door's.
      const stranger = 'a0470000-0000-4000-8000-000000000048';
      peers.auth.on(STATUS_RPC).fail(GrpcStatus.UNAVAILABLE, 'auth is down');

      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/organizations`,
        headers([], { organizationId: stranger }),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls(STATUS_RPC)).toHaveLength(0);
    },
  );

  // ------------------------------------------------------------------ metrics

  rowFor('Ops')(
    '**a request the gate refuses is not counted in `http_requests_total` — only requests that reach a handler are**',
    async () => {
      tenantIs(OrgStatus.FROZEN);
      const total = async (): Promise<number> => {
        const body = await (
          await fetch(`${gateway.metricsUrl}/metrics`)
        ).text();

        return body
          .split('\n')
          .filter((line) => line.startsWith('http_requests_total{'))
          .reduce((sum, line) => sum + Number(line.split(' ').pop()), 0);
      };
      const before = await total();

      const response = await ROUTES.READ.send();

      expect(response.status).toBe(403);
      expect(await total()).toBe(before);
    },
  );
});

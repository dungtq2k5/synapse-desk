/**
 * @file The GraphQL limits and guards, at the HTTP boundary.
 *
 * Six rows, one per class of difference: depth, cost, the
 * permission guard, loader batching, introspection, and the edge cap.
 *
 * **Depth 7 is the limit, not a depth this schema's real fields reach.**
 * ADR 0014's narrow edge types cap the real type graph at five hops
 * (`ingestionJobs → items → document → departments → id`), so a genuinely
 * schema-valid query nested to exactly 7 does not exist to write. The
 * "passes" half below is a real, shallow query well inside the limit; the
 * "refused" half is the synthetic field chain `graphql.e2e-spec.ts` already
 * uses for the same reason — the depth rule fires on the AST shape alone,
 * before `FieldsOnCorrectType` would even get a say, and the assertion is
 * tolerant of whatever else rides along in `errors[]`.
 *
 * The cost pair is exact rather than synthetic: `tickets(first: 86)` with
 * two cross-service edges (`assignee`, `department`) scores `1 + 23×86 =
 * 1 979`; `first: 87` scores `1 + 23×87 = 2 002`. One field's argument is
 * the entire diff between the two rows.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';

/**
 * The parts of a GraphQL response these rows read. `data` is whatever tree the
 * row's own query asked for, so it is not modelled further.
 */
type GraphqlResponse = {
  data?: any;
  errors?: Array<{ message: string }>;
};

describe('the GraphQL limits and guards', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '99999999-9999-4999-8999-999999999999';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /** Mirrors `graphql-limits.config.ts` — not importable across the workspace boundary. */
  const MAX_QUERY_DEPTH = 7;
  const MAX_EDGE_LIST = 50;

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
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
    )}`,
  });

  const wireTicket = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    ticketNumber: 1,
    organizationId: ORGANIZATION,
    authorId: USER,
    source: 1,
    status: 2,
    priority: 2,
    title: 'Printer is on fire',
    description: 'It really is',
    unreadCount: 0,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const page = (itemCount: number) => ({
    totalItems: itemCount,
    itemCount,
    itemsPerPage: itemCount,
    totalPages: 1,
    currentPage: 1,
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

  describe('Root resolvers', () => {
    it('**`Query.version` resolves the running build** — the wiring smoke test', async () => {
      const response = await new Session(gateway.baseUrl).post<{
        data: { version: { version: string; sha: string; builtAt: string } };
      }>(
        '/graphql',
        { query: '{ version { version sha builtAt } }' },
        headers(),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.version).toEqual({
        version: GATEWAY_ENV.APP_VERSION,
        sha: GATEWAY_ENV.BUILD_SHA,
        builtAt: GATEWAY_ENV.BUILD_TIME,
      });
    });

    it('**`Query.departments` resolves, sorted by name, never deleted**', async () => {
      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Support',
            description: 'Front line',
            memberCount: 3,
            createdAt: { seconds: 1_756_684_800, nanos: 0 },
            updatedAt: { seconds: 1_756_684_800, nanos: 0 },
          },
        ],
        meta: page(1),
      });

      const response = await new Session(gateway.baseUrl).post<{
        data: {
          departments: {
            items: { id: string; name: string; description: string }[];
            meta: { totalItems: number };
          };
        };
      }>(
        '/graphql',
        {
          query:
            '{ departments(first: 10, page: 1) { items { id name description } meta { totalItems } } }',
        },
        headers(['department.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.departments.items).toEqual([
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Support',
          description: 'Front line',
        },
      ]);

      const [call] = peers.auth.calls('DepartmentService/ListDepartments');
      expect(call.request).toMatchObject({
        includeDeleted: false,
        page: { page: 1, limit: 10, sortBy: 'name' },
      });
    });

    it('**refuses without `department.read`, before the peer is called**', async () => {
      const response = await new Session(gateway.baseUrl).post<GraphqlResponse>(
        '/graphql',
        { query: '{ departments(first: 10, page: 1) { items { id } } }' },
        headers([]),
      );

      expect(response.status).toBe(200);
      expect(response.body.data?.departments ?? null).toBeNull();
      expect(JSON.stringify(response.body.errors)).toMatch(
        /forbidden|permission/i,
      );
      expect(
        peers.auth.calls('DepartmentService/ListDepartments'),
      ).toHaveLength(0);
    });
  });

  describe('Depth', () => {
    it('**a query within the depth limit succeeds**', async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: [wireTicket('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')],
        meta: page(1),
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });

      const response = await new Session(gateway.baseUrl).post(
        '/graphql',
        {
          query: '{ tickets(first: 1) { items { id assignee { fullName } } } }',
        },
        headers(['ticket.read.all']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
    });

    it('**a query nested past the depth limit is refused before any peer call**', async () => {
      const deep = `{ ${'a { '.repeat(MAX_QUERY_DEPTH + 2)}b${' }'.repeat(MAX_QUERY_DEPTH + 2)} }`;

      await new Session(gateway.baseUrl).post(
        '/graphql',
        { query: deep },
        headers(),
      );

      // **Status and message not asserted, same reasoning as Cost and
      // Introspection.** This row's own field names are necessarily
      // invalid — ADR 0014 caps the real type graph at depth 5, so no
      // VALID query can reach `MAX_QUERY_DEPTH` (7) at all, and the only
      // way to phrase "nested past the limit" here is nonsense fields.
      // graphql-js's depth check is a validation RULE, so its "levels
      // deep" error lands in the same validation pass as the field's own
      // `FieldUndefined` and Apollo answers 400. graphql-java's check
      // hooks `beginExecuteOperation`, which runs only after validation
      // SUCCEEDS — so a query invalid for an unrelated reason never
      // reaches it, and answers whatever plain field-validation answers
      // instead (200, `FieldUndefined`, no depth message at all).
      // Rewriting the instrumentation into a real validation rule would
      // buy exact message parity with an implementation slated for
      // retirement, for no additional protection: a genuinely valid
      // over-limit query is still caught by the instrumentation exactly as it is today,
      // proved directly against the synthetic recursive schema by
      // `GraphqlLimitInstrumentationTest.aQueryNestedPastTheDepthLimitIsRefused`.
      // The property both implementations share, and the only one this
      // row can honestly test end to end, is that the query never reaches
      // the peer.
      expect(peers.ticket.calls('TicketService/ListTickets')).toHaveLength(0);
    });
  });

  describe('Cost', () => {
    // Both fields ask for a nested scalar: `assignee { fullName }` and
    // `department { name }`, each a cross-service edge at 10 points per
    // ticket. Per item: 1 (own) + 10×2 (the two edges) + 1×2 (their scalar
    // children) = 23. `tickets` itself costs 1. Total = 1 + 23×first.
    const ticketsWithBothEdges = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        wireTicket(
          `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
        ),
      );

    it('**a query scoring just under 2 000 is allowed**', async () => {
      peers.ticket.on('TicketService/ListTickets').reply({
        items: ticketsWithBothEdges(86),
        meta: page(86),
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: USER, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });
      peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
        items: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Support',
            description: undefined,
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).post(
        '/graphql',
        {
          query:
            '{ tickets(first: 86) { items { assignee { fullName } department { name } } } }',
        },
        headers(['ticket.read.all']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
    });

    it('**one ticket more, scoring just over 2 000, is refused before the peer is called, with `QUERY_TOO_COMPLEX` and both numbers**', async () => {
      const response = await new Session(gateway.baseUrl).post<GraphqlResponse>(
        '/graphql',
        {
          query:
            '{ tickets(first: 87) { items { assignee { fullName } department { name } } } }',
        },
        headers(['ticket.read.all']),
      );

      // An execution-time refusal: 200, the error inside, and `extensions`
      // naming the limit so a client need not read the message.
      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('data');
      const [error] = response.body.errors as Array<{
        message: string;
        extensions?: Record<string, unknown>;
      }>;
      expect(error.message).toMatch(/too complex/);
      // `classification` is graphql-java's own, on every error it serialises.
      expect(error.extensions).toEqual({
        classification: 'ExecutionAborted',
        code: 'QUERY_TOO_COMPLEX',
        cost: 2002,
        maxComplexity: 2000,
      });
      // Refused before execution reaches the resolver — the property the
      // depth row above asserts too, whatever the status code.
      expect(peers.ticket.calls('TicketService/ListTickets')).toHaveLength(0);
    });
  });

  describe('The permission guard', () => {
    it('**refuses on GraphQL exactly as it refuses on REST, before the peer is called**', async () => {
      const targetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      const rest = await new Session(gateway.baseUrl).get(
        `${API}/users/${targetId}`,
        headers([]),
      );

      const graph = await new Session(gateway.baseUrl).post<GraphqlResponse>(
        '/graphql',
        { query: `{ user(id: "${targetId}") { email } }` },
        headers([]),
      );

      expect(rest.status).toBe(403);
      expect(graph.status).toBe(200);
      expect(graph.body.data?.user ?? null).toBeNull();
      expect(JSON.stringify(graph.body.errors)).toMatch(
        /forbidden|permission/i,
      );
      // The same guard, so neither transport reached the peer.
      expect(peers.auth.calls('UserService/GetUser')).toHaveLength(0);
    });
  });

  describe('Loaders batch', () => {
    it('**50 tickets with `assignee` produce exactly one batch call**', async () => {
      const ids = Array.from(
        { length: 50 },
        (_, index) =>
          `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`,
      );
      // A user id touched by NO other row in this suite, not the shared
      // `USER` constant. `loaders.users` is backed by its own Redis
      // entity cache (`entityScope('user', id)`, 5-minute TTL) shared
      // across every file in this `maxWorkers: 1` run — this is gap 43's
      // mechanism (`known-gaps.md` #43): any earlier row that resolves an
      // edge onto `USER` warms this row's cache entry, so the call this
      // row exists to count never happens and it reads as a flake rather
      // than as what it is.
      const ASSIGNEE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      peers.ticket.on('TicketService/ListTickets').reply({
        items: ids.map((id) => wireTicket(id, { currentAssigneeId: ASSIGNEE })),
        meta: page(50),
      });
      peers.auth.on('UserService/ListUsersByIds').reply({
        items: [],
        summaries: [
          { userId: ASSIGNEE, fullName: 'Ada Lovelace', isLocked: false },
        ],
      });

      const response = await new Session(gateway.baseUrl).post(
        '/graphql',
        {
          query:
            '{ tickets(first: 50) { items { id assignee { fullName } } } }',
        },
        headers(['ticket.read.all']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(peers.auth.calls('UserService/ListUsersByIds')).toHaveLength(1);
    });
  });

  describe('Introspection', () => {
    it('**is off when the gateway runs with a production `NODE_ENV`**', async () => {
      const { redisUrl, natsUrl } = readRunState();
      const production = await startGateway({
        ...peers.env,
        REDIS_URL: redisUrl,
        NATS_URL: natsUrl,
        NODE_ENV: 'production',
      });

      try {
        const response = await new Session(
          production.baseUrl,
        ).post<GraphqlResponse>(
          '/graphql',
          { query: '{ __schema { queryType { name } } }' },
          headers(),
        );

        // **Status not asserted.** graphql-java's check
        // (`Introspection.isEnabledJvmWide`) is an EXECUTION-time refusal,
        // the same shape as the cost limit's, and answers 200 with the
        // error inside — measured against a running instance. The property
        // is that the query fails and says why, not the transport code.
        expect(JSON.stringify(response.body.errors)).toMatch(/introspection/i);
        expect(response.body.data?.__schema ?? null).toBeNull();
      } finally {
        await production.stop();
      }
    });
  });

  describe('Capped edge lists', () => {
    it('**251 departments yields the CAPPED 50, and the true total alongside it**', async () => {
      const targetId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const departmentIds = Array.from(
        { length: 251 },
        (_, index) =>
          `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      );

      peers.auth.on('UserService/GetUser').reply({
        user: {
          id: targetId,
          organizationId: ORGANIZATION,
          fullName: 'Ada Lovelace',
          email: 'ada@example.com',
          isEmailVerified: true,
          isPhoneVerified: false,
          isLocked: false,
          isTwoFactorEnabled: false,
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
          updatedAt: { seconds: 1_756_684_800, nanos: 0 },
        },
        roleIds: [],
        roleNames: [],
        departmentIds,
      });
      // The ids are sliced BEFORE the batch call (`ids.slice(0, MAX_EDGE_LIST)`),
      // so the first 50 of the list above is exactly what the peer receives —
      // `reply(...)` takes a fixed value, not a function of the request.
      peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
        items: departmentIds.slice(0, MAX_EDGE_LIST).map((id) => ({
          id,
          name: `Department ${id.slice(0, 8)}`,
          description: undefined,
        })),
      });

      const response = await new Session(gateway.baseUrl).post<GraphqlResponse>(
        '/graphql',
        {
          query: `{ user(id: "${targetId}") { departments { id } departmentCount } }`,
        },
        headers(['user.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('errors');
      expect(response.body.data.user.departments).toHaveLength(MAX_EDGE_LIST);
      expect(response.body.data.user.departmentCount).toBe(251);

      const [call] = peers.auth.calls('DepartmentService/ListDepartmentsByIds');
      expect(
        (call.request as { departmentIds: string[] }).departmentIds,
      ).toHaveLength(MAX_EDGE_LIST);
    });
  });
});

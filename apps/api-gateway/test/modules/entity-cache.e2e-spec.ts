import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import Redis from 'ioredis';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { timestamp, wireUser } from '../fixtures/wire';
import { CacheService } from '../../src/common/cache/cache.service';
import { RedisService } from '../../src/common/redis/redis.service';
import {
  ENTITY_TTL_SECONDS,
  entityScope,
} from '../../src/common/config/cache.config';
import { createUserSummaryLoader } from '../../src/common/graphql/loaders/user-summary.loader';

/**
 * The GraphQL entity cache.
 *
 * **The layer that pays and stays correct.** A response cache key is a hash of
 * the question and says nothing about which entities are in the answer; an
 * entity key is enumerable, so the mutation that changed a name evicts exactly
 * one key. These tests are about that difference.
 */
describe('The entity cache (e2e)', () => {
  let fx: E2eFixture;
  let cache: CacheService;

  const organizationId = faker.string.uuid();
  const otherOrganizationId = faker.string.uuid();

  const gql = (query: string, overrides: Record<string, unknown> = {}) =>
    authenticatedAgent(fx.app, {
      organizationId,
      permissionCodes: ['ticket.read.all'],
      ...overrides,
    })
      .post('/graphql')
      .send({ query });

  const wireSummary = (userId: string, fullName: string) => ({
    userId,
    fullName,
    avatarUrl: undefined,
    isLocked: false,
  });

  /**
   * What the loader ANSWERS for that row: `createUserSummaryLoader` maps the
   * wire message itself, so a caller receives the GraphQL edge type. Not the
   * same object as `wireSummary`, which is what the RPC stub returns.
   */
  const loadedSummary = (userId: string, fullName: string) => ({
    id: userId,
    fullName,
    avatarUrl: null,
    isLocked: false,
    deletedAt: null,
  });

  /** Enum fields are NUMBERS on the wire — the generated proto types, not the DTO. */
  const wireTicket = (id: string, assigneeId: string) => ({
    id,
    ticketNumber: 1,
    organizationId,
    authorId: faker.string.uuid(),
    source: 1,
    status: 2,
    priority: 2,
    title: 'Printer is on fire',
    description: 'Again',
    currentAssigneeId: assigneeId,
    currentDepartmentId: faker.string.uuid(),
    unreadCount: 0,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    cache = fx.app.get(CacheService);
  }, 30_000);

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('test 1 — a second request makes no RPC call', () => {
    it('**the same user across two REQUESTS is fetched once**', async () => {
      // The per-request DataLoader already dedups within one query. This is the
      // half it cannot do: two separate HTTP requests, one gRPC call.
      const ticketId = faker.string.uuid();
      const assigneeId = faker.string.uuid();

      fx.stubs.ticket.getTicket.mockReturnValue(
        of(wireTicket(ticketId, assigneeId)),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({ items: [], summaries: [wireSummary(assigneeId, 'Ada')] }),
      );

      const query = `{ ticket(id: "${ticketId}") { assignee { id fullName } } }`;

      const first = await gql(query).expect(200);
      const second = await gql(query).expect(200);

      expect(first.body.data.ticket.assignee.fullName).toBe('Ada');
      expect(second.body.data.ticket.assignee.fullName).toBe('Ada');
      expect(fx.stubs.user.listUsersByIds).toHaveBeenCalledTimes(1);
    });
  });

  describe('the loaders see the AUTHENTICATED caller', () => {
    it('**the batch RPC carries the tenant, not the anonymous context**', async () => {
      // The regression guard for the bug this step uncovered. Apollo builds the
      // GraphQL context BEFORE any NestJS guard runs, so `req.user` is
      // undefined there — and reading it eagerly gave every request's loaders
      // `organizationId: null`.
      //
      // In production `ListUsersByIds` rejects an empty `organizationId` with
      // `INVALID_ARGUMENT`, so the whole user half of the entity graph failed.
      // Every e2e passed anyway, because a gRPC stub answers whatever it is
      // asked, whoever asks — which is exactly why this asserts on the REQUEST
      // rather than on the response.
      const ticketId = faker.string.uuid();
      const assigneeId = faker.string.uuid();

      fx.stubs.ticket.getTicket.mockReturnValue(
        of(wireTicket(ticketId, assigneeId)),
      );
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({ items: [], summaries: [wireSummary(assigneeId, 'Ada')] }),
      );

      await gql(
        `{ ticket(id: "${ticketId}") { assignee { fullName } } }`,
      ).expect(200);

      const [[sent]] = fx.stubs.user.listUsersByIds.mock.calls;

      expect(sent.organizationId).toBe(organizationId);
    });
  });

  describe('test 4 — two tenants caching the same uuid', () => {
    it('**do not share an entry**', async () => {
      // The id carries no tenant; the KEY does. Without the tenant segment the
      // second tenant would read the first tenant's user under an id that
      // happens to collide — and uuids collide when a fixture reuses one, which
      // is exactly what an integration test does.
      const userId = faker.string.uuid();

      await cache.wrap(
        { organizationId, scope: entityScope('user', userId) },
        ENTITY_TTL_SECONDS,
        () => Promise.resolve(wireSummary(userId, 'Tenant A Ada')),
      );

      const other = await cache.wrap(
        {
          organizationId: otherOrganizationId,
          scope: entityScope('user', userId),
        },
        ENTITY_TTL_SECONDS,
        () => Promise.resolve(wireSummary(userId, 'Tenant B Bob')),
      );

      expect(other.fullName).toBe('Tenant B Bob');
    });
  });

  describe('test 3 — a write evicts the entity precisely', () => {
    it('**`PATCH /users/me` evicts that user and nothing else**', async () => {
      const me = faker.string.uuid();
      const somebodyElse = faker.string.uuid();

      await cache.wrap(
        { organizationId, scope: entityScope('user', me) },
        ENTITY_TTL_SECONDS,
        () => Promise.resolve(wireSummary(me, 'Old name')),
      );
      await cache.wrap(
        { organizationId, scope: entityScope('user', somebodyElse) },
        ENTITY_TTL_SECONDS,
        () => Promise.resolve(wireSummary(somebodyElse, 'Untouched')),
      );

      // `UpdateOwnProfile` answers a FLAT user — unlike `GetUser`/`UpdateUser`,
      // which answer the envelope. Two neighbouring RPCs, two shapes.
      fx.stubs.user.updateOwnProfile.mockReturnValue(
        of({ ...wireUser(), id: me, fullName: 'New name' }),
      );

      await authenticatedAgent(fx.app, { sub: me, organizationId })
        .patch(`${API}/users/me`)
        .send({ fullName: 'New name' })
        .expect(200);

      const survived = async (id: string) => {
        let origin = false;

        await cache.wrap(
          { organizationId, scope: entityScope('user', id) },
          ENTITY_TTL_SECONDS,
          () => {
            origin = true;

            return Promise.resolve(wireSummary(id, 'refetched'));
          },
        );

        return !origin;
      };

      expect(await survived(me)).toBe(false);
      // **The point of an entity cache.** A scope-wide eviction would have taken
      // this one too, and a response cache could not have found either.
      expect(await survived(somebodyElse)).toBe(true);
    });

    it('and the next query sees the new name', async () => {
      const ticketId = faker.string.uuid();
      const me = faker.string.uuid();

      fx.stubs.ticket.getTicket.mockReturnValue(of(wireTicket(ticketId, me)));
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({ items: [], summaries: [wireSummary(me, 'Old name')] }),
      );
      // `UpdateOwnProfile` answers a FLAT user — unlike `GetUser`/`UpdateUser`,
      // which answer the envelope. Two neighbouring RPCs, two shapes.
      fx.stubs.user.updateOwnProfile.mockReturnValue(
        of({ ...wireUser(), id: me, fullName: 'New name' }),
      );

      const query = `{ ticket(id: "${ticketId}") { assignee { fullName } } }`;

      expect((await gql(query)).body.data.ticket.assignee.fullName).toBe(
        'Old name',
      );

      await authenticatedAgent(fx.app, { sub: me, organizationId })
        .patch(`${API}/users/me`)
        .send({ fullName: 'New name' })
        .expect(200);

      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({ items: [], summaries: [wireSummary(me, 'New name')] }),
      );

      expect((await gql(query)).body.data.ticket.assignee.fullName).toBe(
        'New name',
      );
    });
  });

  describe('test 5 — Redis down, the query still succeeds', () => {
    it('**the loader falls through to the RPC**', async () => {
      // Fail open, at the layer where failing closed would take out every edge
      // in the schema at once.
      const dead = new Redis('redis://127.0.0.1:6399', {
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      dead.on('error', () => undefined);

      const offline = new CacheService({ client: dead } as RedisService);
      const userId = faker.string.uuid();

      const fetch = jest.fn(() =>
        Promise.resolve({
          summaries: [wireSummary(userId, 'From the RPC')],
          items: [],
        }),
      );

      const loader = createUserSummaryLoader(
        {
          getService: () => ({ listUsersByIds: () => of(fetch()) }),
        } as never,
        () => ({
          sub: 'x',
          organizationId,
          isSuperAdmin: false,
          departmentIds: [],
          permissionCodes: [],
          isEmailVerified: true,
          ip: '',
          userAgent: '',
        }),
        offline,
      );

      await expect(loader.load(userId)).resolves.toEqual(
        loadedSummary(userId, 'From the RPC'),
      );

      dead.disconnect();
    });
  });
});

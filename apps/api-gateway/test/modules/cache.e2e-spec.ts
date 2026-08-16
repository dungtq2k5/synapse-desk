import { DocumentFileType, DocumentStatus } from '@synapsedesk/grpc-proto';
import Redis from 'ioredis';
import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { timestamp } from '../fixtures/wire';
import { AnalyticsCacheService } from '../../src/modules/analytics/analytics-cache.service';
import { CacheService } from '../../src/common/cache/cache.service';
import { entityScope } from '../../src/common/config/cache.config';
import { RedisService } from '../../src/common/redis/redis.service';
import { compareAlphabetically } from '@synapsedesk/common';

/**
 * The shared cache, against a REAL Redis
 *
 * The unit suite beside `cache.service.ts` covers key construction and the
 * fail-open behaviour with a fake. These two need the real thing: one is about
 * what a second tenant RETRIEVES, which a key-equality assertion cannot see,
 * and the other is about what an actually-unreachable Redis does, which a fake
 * that throws on command can only approximate.
 */
describe('§29 the shared cache (e2e)', () => {
  let fx: E2eFixture;
  let cache: CacheService;

  const ORG_A = faker.string.uuid();
  const ORG_B = faker.string.uuid();

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    cache = fx.app.get(CacheService);
  }, 30_000);

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('§1 test 1 — two tenants never share an entry', () => {
    it("**the second tenant receives ITS OWN answer, not the first tenant's**", async () => {
      // The whole reason this service exists, and asserted on the retrieved
      // VALUE rather than on key inequality: two keys can differ and a lookup
      // can still land on the wrong one, and it is the value a user sees.
      //
      // This is the failure the default `CacheInterceptor` ships with — its key
      // is the request URL, which carries no tenant, so `GET /roles` is one
      // entry for the whole platform.
      const scope = 'roles';
      const params = { page: 1 };

      const first = await cache.wrap(
        { organizationId: 'org-a', scope, params },
        60,
        () => Promise.resolve({ items: ["org A's roles"] }),
      );

      const second = await cache.wrap(
        { organizationId: 'org-b', scope, params },
        60,
        () => Promise.resolve({ items: ["org B's roles"] }),
      );

      expect(first).toEqual({ items: ["org A's roles"] });
      expect(second).toEqual({ items: ["org B's roles"] });
    });

    it('and org A still reads its own entry afterwards', async () => {
      // The other direction: B's write must not have overwritten A's.
      const input = { organizationId: 'org-a', scope: 'roles' };

      await cache.wrap(input, 60, () => Promise.resolve('A'));
      await cache.wrap({ ...input, organizationId: 'org-b' }, 60, () =>
        Promise.resolve('B'),
      );

      const reread = await cache.wrap(input, 60, () =>
        Promise.resolve('ORIGIN WAS CALLED'),
      );

      expect(reread).toBe('A');
    });
  });

  describe('§1 test 4 — a cache fails OPEN', () => {
    it('**an unreachable Redis still answers, from the origin**', async () => {
      // A cache outage must make the product slow, not down. Against a port
      // nothing is listening on, so the failure is a real connection refusal
      // rather than a stubbed rejection — the two take different paths through
      // ioredis and only one of them is what production does.
      const dead = new Redis('redis://127.0.0.1:6399', {
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
        // Without this the command is QUEUED until a connection exists, so the
        // call would hang for the test's whole timeout instead of failing.
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      dead.on('error', () => undefined);

      const offline = new CacheService({ client: dead } as RedisService);
      const produce = jest.fn().mockResolvedValue('served from the origin');
      const input = { organizationId: 'org-a', scope: 'roles' };

      await expect(offline.wrap(input, 60, produce)).resolves.toBe(
        'served from the origin',
      );

      // **The half that stops this passing vacuously.** The assertion above
      // holds whether or not Redis is actually down — a healthy cache would
      // also return the produced value on a miss. Calling twice separates
      // them: with a working Redis the second call is a hit and `produce` runs
      // once, so two calls prove the WRITE failed too and the outage was real.
      await offline.wrap(input, 60, produce);

      expect(produce).toHaveBeenCalledTimes(2);

      dead.disconnect();
    });
  });

  describe('§3 cached reads', () => {
    const permissionsAgent = (organizationId: string) =>
      authenticatedAgent(fx.app, {
        organizationId,
        permissionCodes: ['role.read'],
      });

    const wirePermissions = (name: string) => ({
      items: [
        { id: faker.string.uuid(), code: 'role.read', name, group: 'role' },
      ],
    });

    it('**a second read does not reach auth-service**', async () => {
      fx.stubs.role.listPermissions.mockReturnValue(
        of(wirePermissions('Read roles')),
      );

      await permissionsAgent(ORG_A).get(`${API}/permissions`).expect(200);
      const second = await permissionsAgent(ORG_A)
        .get(`${API}/permissions`)
        .expect(200);

      expect(fx.stubs.role.listPermissions).toHaveBeenCalledTimes(1);
      // And the payload survived the round trip intact — a cache that answers
      // with a differently-shaped body is worse than one that misses.
      expect(second.body.data[0].name).toBe('Read roles');
    });

    it('**the entry is physically in Redis, with a TTL**', async () => {
      // Closes the gap between "the code is right" and "it is wired in". The
      // call-count assertions above would also pass if `wrap` were a no-op that
      // memoised in process — this reads the shared store the way another pod
      // would.
      //
      // And it is the only place the TTL is checked at all: `ttlSeconds` is
      // passed through four layers, and a dropped `'EX'` is invisible to every
      // other test here — the entry simply never expires, which reads as a
      // cache working unusually well.
      fx.stubs.role.listPermissions.mockReturnValue(
        of(wirePermissions('Read roles')),
      );

      await permissionsAgent(ORG_A).get(`${API}/permissions`).expect(200);

      const client = fx.app.get(RedisService).client;
      const keys = await client.keys(`cache:${ORG_A}|permissions|*`);

      expect(keys).toEqual([`cache:${ORG_A}|permissions|`]);

      const ttl = await client.ttl(keys[0]);

      // Positive and no larger than the hour the decorator declares. `-1` is
      // the value that matters: it means the key has NO expiry.
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60);
    });

    it('**and the envelope is rebuilt on a HIT, not served from the cache**', async () => {
      // The interceptor caches the handler's RETURN VALUE. Caching the whole
      // HTTP response instead would freeze `statusCode` and whichever
      // `warning` happened to be attached to the miss.
      fx.stubs.role.listPermissions.mockReturnValue(
        of(wirePermissions('Read roles')),
      );

      const miss = await permissionsAgent(ORG_A).get(`${API}/permissions`);
      const hit = await permissionsAgent(ORG_A).get(`${API}/permissions`);

      expect(hit.body).toEqual(miss.body);
      expect(hit.body.success).toBe(true);
      expect(hit.body.statusCode).toBe(200);
    });

    it('**two tenants never share a cached read**', async () => {
      // Through a real route: the failure the default
      // `CacheInterceptor` ships with, since its key is the request URL.
      fx.stubs.role.listPermissions.mockReturnValueOnce(
        of(wirePermissions("tenant A's catalogue")),
      );
      fx.stubs.role.listPermissions.mockReturnValueOnce(
        of(wirePermissions("tenant B's catalogue")),
      );

      const a = await permissionsAgent(ORG_A).get(`${API}/permissions`);
      const b = await permissionsAgent(ORG_B).get(`${API}/permissions`);

      expect(a.body.data[0].name).toBe("tenant A's catalogue");
      expect(b.body.data[0].name).toBe("tenant B's catalogue");
      expect(fx.stubs.role.listPermissions).toHaveBeenCalledTimes(2);
    });

    it('a write evicts it, and the next read reaches the origin again', async () => {
      fx.stubs.role.listPermissions.mockReturnValue(
        of(wirePermissions('Read roles')),
      );
      fx.stubs.role.createRole.mockReturnValue(
        of({
          id: faker.string.uuid(),
          name: 'Auditor',
          description: undefined,
          isSystemRole: false,
          userAssigned: 0,
          permissionCodes: [],
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }),
      );

      await permissionsAgent(ORG_A).get(`${API}/permissions`).expect(200);
      await permissionsAgent(ORG_A).get(`${API}/permissions`).expect(200);
      expect(fx.stubs.role.listPermissions).toHaveBeenCalledTimes(1);

      await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        permissionCodes: ['role.create'],
      })
        .post(`${API}/roles`)
        .send({ name: 'Auditor', permissionCodes: [] })
        .expect(201);

      await permissionsAgent(ORG_A).get(`${API}/permissions`).expect(200);

      // **Not two.** `POST /roles` invalidates the `roles` scope, and
      // `permissions` is a DIFFERENT scope that the role write does not touch:
      // the catalogue is seeded and changes on deploy.
      expect(fx.stubs.role.listPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe("§3 `varyBy: 'caller'` — the leak it exists to prevent", () => {
    const inDepartments = (departmentIds: string[]) =>
      authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        departmentIds,
        permissionCodes: [],
      });

    const wireDocuments = (title: string) => ({
      items: [
        {
          id: faker.string.uuid(),
          organizationId: ORG_A,
          createdById: faker.string.uuid(),
          title,
          fileUrl: 'organizations/a/documents/x.pdf',
          // **`'application/pdf'` used to sit here, and the column holds an
          // EXTENSION.** Exactly the confusion `DocumentFileType`'s doc comment
          // warns about: a MIME type in this field matches no row and reports an
          // empty page rather than an error. Unexpressible now.
          fileType: DocumentFileType.DOCUMENT_FILE_TYPE_PDF,
          fileSizeBytes: 10,
          isOrganizationWide: false,
          // `'READY'` is not a DocumentStatus either — the indexed state is INDEXED.
          status: DocumentStatus.DOCUMENT_STATUS_INDEXED,
          departmentIds: [],
          chunkCount: 1,
          ocrLanguages: [],
          createdAt: timestamp(),
          updatedAt: timestamp(),
        },
      ],
      meta: {
        totalItems: 1,
        itemCount: 1,
        itemsPerPage: 20,
        totalPages: 1,
        currentPage: 1,
      },
    });

    it('**two callers in DIFFERENT departments do not share an entry**', async () => {
      // `GET /documents` is filtered by `visibilityScope` in ingestion-service
      // — org-wide ∪ the caller's departments. A tenant-only key would serve
      // Finance's documents to Support: the right tenant, somebody else's
      // answer. This is the tenant-key failure one level down, and it is why
      // `varyBy` has no default.
      const finance = faker.string.uuid();
      const support = faker.string.uuid();

      fx.stubs.document.listDocuments.mockReturnValueOnce(
        of(wireDocuments('Finance handbook')),
      );
      fx.stubs.document.listDocuments.mockReturnValueOnce(
        of(wireDocuments('Support runbook')),
      );

      const a = await inDepartments([finance]).get(`${API}/documents`);
      const b = await inDepartments([support]).get(`${API}/documents`);

      expect(a.body.data.items[0].title).toBe('Finance handbook');
      expect(b.body.data.items[0].title).toBe('Support runbook');
      expect(fx.stubs.document.listDocuments).toHaveBeenCalledTimes(2);
    });

    it('**but two callers in the SAME departments do**', async () => {
      // The other half: keying on the caller's IDENTITY would be trivially
      // safe and would collapse the hit rate to nothing. The key is what the
      // caller can SEE, which is the granularity ingestion filters at.
      const shared = [faker.string.uuid(), faker.string.uuid()];

      fx.stubs.document.listDocuments.mockReturnValue(
        of(wireDocuments('Shared handbook')),
      );

      await inDepartments(shared).get(`${API}/documents`).expect(200);
      await inDepartments([...shared].reverse())
        .get(`${API}/documents`)
        .expect(200);

      // Reversed on purpose: a department list is a SET, and an id order that
      // varies between tokens would split one audience into two entries.
      expect(fx.stubs.document.listDocuments).toHaveBeenCalledTimes(1);
    });

    it('**and a digest that always collided would fail this**', async () => {
      // The reversed-array test proves equal sets MERGE; on its own
      // that also passes for a digest returning a constant, which would merge
      // every caller in the tenant into one entry — the leak, with a green
      // test beside it. This is the separating half.
      const finance = [faker.string.uuid()];
      const support = [faker.string.uuid()];
      const both = [...finance, ...support];

      fx.stubs.document.listDocuments.mockReturnValue(of(wireDocuments('any')));

      await inDepartments(finance).get(`${API}/documents`).expect(200);
      await inDepartments(support).get(`${API}/documents`).expect(200);
      await inDepartments(both).get(`${API}/documents`).expect(200);

      // Three distinct audiences, three misses. A constant digest gives one.
      expect(fx.stubs.document.listDocuments).toHaveBeenCalledTimes(3);
    });

    it('and a super admin does not share with an ordinary member', async () => {
      // `visibilityScope` returns `{}` for a super admin — they see every
      // document in the tenant, which is emphatically not what a member sees.
      fx.stubs.document.listDocuments.mockReturnValueOnce(
        of(wireDocuments('Member view')),
      );
      fx.stubs.document.listDocuments.mockReturnValueOnce(
        of(wireDocuments('Everything')),
      );

      await inDepartments([]).get(`${API}/documents`).expect(200);
      const admin = await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        departmentIds: [],
        isSuperAdmin: true,
        permissionCodes: [],
      }).get(`${API}/documents`);

      expect(admin.body.data.items[0].title).toBe('Everything');
      expect(fx.stubs.document.listDocuments).toHaveBeenCalledTimes(2);
    });
  });

  describe('a cache must not bypass authorization', () => {
    const wireDeleted = () => ({
      items: [
        {
          id: faker.string.uuid(),
          organizationId: ORG_A,
          name: 'A DELETED DEPARTMENT',
          description: undefined,
          memberCount: 0,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        },
      ],
      meta: {
        totalItems: 1,
        itemCount: 1,
        itemsPerPage: 20,
        totalPages: 1,
        currentPage: 1,
      },
    });

    it('**a warmed privileged entry is NOT served to an unprivileged caller**', async () => {
      // This was live. `?includeDeleted=true` was authorized inside the
      // handler, and `@Cacheable` short-circuits the handler on a hit — so a
      // caller holding `department.delete` warmed the entry and the next caller
      // without it received deleted departments with a 200. The 403 never ran.
      //
      // The fix is structural rather than a key change: the check moved into
      // `QueryPermissionGuard`, and guards run before interceptors.
      fx.stubs.department.listDepartments.mockReturnValue(of(wireDeleted()));

      const privileged = await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        permissionCodes: ['department.read', 'department.delete'],
      }).get(`${API}/departments?includeDeleted=true`);

      expect(privileged.status).toBe(200);
      expect(privileged.body.data.items[0].name).toBe('A DELETED DEPARTMENT');

      const plain = await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        permissionCodes: ['department.read'],
      }).get(`${API}/departments?includeDeleted=true`);

      expect(plain.status).toBe(403);
    });

    it('and the ordinary cached read still works for both', async () => {
      // The guard must not gate the route it protects a parameter on — which is
      // exactly what a second `@RequirePermission` would have done.
      fx.stubs.department.listDepartments.mockReturnValue(of(wireDeleted()));

      const plain = await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        permissionCodes: ['department.read'],
      }).get(`${API}/departments`);

      expect(plain.status).toBe(200);
    });

    it('**and the guard reads the RAW query, before the ValidationPipe**', async () => {
      // A guard runs before transformation, so `includeDeleted` is the string
      // `'true'` there, not the boolean. A `=== true` check would pass
      // everybody and the guard would silently do nothing — which is the same
      // shape of failure it was written to fix.
      fx.stubs.department.listDepartments.mockReturnValue(of(wireDeleted()));

      const plain = await authenticatedAgent(fx.app, {
        organizationId: ORG_A,
        permissionCodes: ['department.read'],
      }).get(`${API}/departments?includeDeleted=true`);

      expect(plain.status).toBe(403);
    });
  });

  describe('the wiring', () => {
    it('resolves from the container, over the SHARED connection', () => {
      // Not a tautology: `CacheService` taking its own `new Redis(...)` would
      // still pass every test above while being the eighth connection the design
      // exists to prevent.
      expect(cache).toBeInstanceOf(CacheService);
      expect(fx.app.get(RedisService).client).toBeDefined();
    });

    it('**and analytics writes through the SAME store, under the shared prefix**', async () => {
      // Proves the delegation and the shared connection at once, which is what
      // step 2 actually changed. `AnalyticsCacheService` used to own a
      // connection and a key format; now it owns a TTL policy and a scope, and
      // its entries are addressable by the same `SCAN` as everything else.
      const analytics = fx.app.get(AnalyticsCacheService);
      const organizationId = 'org-a';

      await analytics.wrap(
        { organizationId, endpoint: 'overview', params: { to: '2026-01-01' } },
        60,
        () => Promise.resolve({ total: 7 }),
      );

      const client = fx.app.get(RedisService).client;
      const keys = await client.keys('cache:org-a|analytics:*');

      expect(keys).toEqual(['cache:org-a|analytics:overview|to=2026-01-01']);

      // And the generic scope invalidation reaches it — the property that
      // makes `invalidateTenant` still mean what its docblock says.
      await expect(analytics.invalidateTenant(organizationId)).resolves.toBe(1);
    });

    it('**and `invalidateTenant` spares every NON-analytics scope**', async () => {
      // Its name says tenant and its docblock says analytics, and
      // under the now-shared `cache:` prefix a genuinely tenant-wide wipe would
      // also drop roles, departments, organizations and every cached entity —
      // turning an operator's backfill tool into a cold-start for the tenant.
      const organizationId = 'org-a';
      const analytics = fx.app.get(AnalyticsCacheService);

      await analytics.wrap(
        { organizationId, endpoint: 'overview', params: {} },
        60,
        () => Promise.resolve({ total: 1 }),
      );
      await cache.wrap({ organizationId, scope: 'roles' }, 60, () =>
        Promise.resolve('roles'),
      );
      await cache.wrap(
        { organizationId, scope: entityScope('user', 'abc') },
        60,
        () => Promise.resolve('a user'),
      );

      await expect(analytics.invalidateTenant(organizationId)).resolves.toBe(1);

      const survivors = await fx.app
        .get(RedisService)
        .client.keys('cache:org-a|*');

      survivors.sort(compareAlphabetically);
      expect(survivors).toEqual(
        ['cache:org-a|entity:user:abc|', 'cache:org-a|roles|'].sort(
          compareAlphabetically,
        ),
      );
    });
  });
});

import { faker } from '@faker-js/faker';
import { of } from 'rxjs';
import {
  TICKET_PATTERNS,
  DOCUMENT_PATTERNS,
  OrgStatus,
} from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import {
  API,
  RealtimeFixture,
  authenticatedAgent,
  bootstrapRealtimeTest,
} from '../utils';
import { timestamp } from '../fixtures/wire';
import { CacheService } from '../../src/common/cache/cache.service';
import { CACHE_SCOPES } from '../../src/common/config/cache.config';

/**
 * Cache eviction, both halves — 29-doc §4.
 *
 * **On the realtime fixture rather than the plain one**, because the half that
 * matters here needs a REAL NATS round trip: the gateway must evict on a change
 * it never saw, and publishing through a `ClientProxy` is the only way to
 * exercise the framing production uses (a raw publish of a domain event looks
 * like an envelope to Nest's deserializer and delivers `undefined`).
 */
describe('§29 §4 cache invalidation (e2e)', () => {
  let fx: RealtimeFixture;
  let cache: CacheService;

  const organizationId = faker.string.uuid();
  const otherOrganizationId = faker.string.uuid();

  /** Waits for the consumer, which is fire-and-forget by design. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  /** Every HTTP test needs this: the lifecycle gate runs before any handler. */
  const allowTenant = (): void => {
    fx.stubs.organization.getOrganizationStatus.mockReturnValue(
      of({ status: toProtoOrgStatus(OrgStatus.ACTIVE), deleted: false }),
    );
  };

  /** Seeds an entry and returns a probe that says whether it survived. */
  const seed = async (tenant: string, scope: string): Promise<void> => {
    await cache.wrap({ organizationId: tenant, scope }, 300, () =>
      Promise.resolve({ seeded: true }),
    );
  };

  const survives = async (tenant: string, scope: string): Promise<boolean> => {
    let originCalled = false;

    await cache.wrap({ organizationId: tenant, scope }, 300, () => {
      originCalled = true;

      return Promise.resolve({ seeded: false });
    });

    return !originCalled;
  };

  beforeAll(async () => {
    fx = await bootstrapRealtimeTest();
    cache = fx.app.get(CacheService);
  }, 30_000);

  /**
   * Drops the CACHE keys only — deliberately not `flushTestRedis()`.
   *
   * The blunt flush wipes the organization-status cache, which lives in the
   * same Redis; the next authenticated request then misses it, calls
   * `GetOrganizationStatus`, and 500s on a fixture that never stubbed it. That
   * is a real property of a shared Redis, and it is the reason
   * `invalidateScope` is scoped rather than a `flushdb`: neighbouring
   * subsystems are in there.
   */
  const clearCacheKeys = async (): Promise<void> => {
    const keys = await fx.redis.keys('cache:*');
    if (keys.length > 0) await fx.redis.del(...keys);
  };

  beforeEach(() => clearCacheKeys());

  afterAll(() => fx.close());

  describe('§4.2 test 3 — a change the gateway never saw', () => {
    it('**a ticket write originating in ticket-service evicts the gateway entry**', async () => {
      // **The test worth writing first.** Everything else in this file fails
      // visibly; a decorator-only implementation looks complete and is silently
      // partial — it covers ONE origin out of four (28-doc §3). A ticket also
      // changes over the WebSocket, inside escalation side effects, and from a
      // scheduled job, and a decorator on a gateway route sees none of them.
      await seed(organizationId, CACHE_SCOPES.tickets);
      expect(await survives(organizationId, CACHE_SCOPES.tickets)).toBe(true);

      await fx.publishOn(TICKET_PATTERNS.statusChanged, {
        pattern: TICKET_PATTERNS.statusChanged,
        organizationId,
        ticketId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.tickets)).toBe(false);
    });

    it('**and so does every OTHER ticket pattern, not just one**', async () => {
      // `@EventPattern` overwrites its metadata, so stacked decorators would
      // subscribe to exactly one of these and drop the rest silently. The unit
      // spec pins the metadata; this proves the subscription is live.
      for (const pattern of Object.values(TICKET_PATTERNS)) {
        await clearCacheKeys();
        await seed(organizationId, CACHE_SCOPES.tickets);

        await fx.publishOn(pattern, {
          pattern,
          organizationId,
          ticketId: faker.string.uuid(),
          occurredAt: new Date().toISOString(),
        });
        await settle();

        expect({
          pattern,
          survived: await survives(organizationId, CACHE_SCOPES.tickets),
        }).toEqual({ pattern, survived: false });
      }
    }, 30_000);

    it('a document becoming readable evicts the documents scope', async () => {
      await seed(organizationId, CACHE_SCOPES.documents);

      await fx.publishOn(DOCUMENT_PATTERNS.indexed, {
        organizationId,
        documentId: faker.string.uuid(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.documents)).toBe(
        false,
      );
    });

    it('**but `document.uploaded` does NOT** — nothing is readable yet', async () => {
      // The worker's trigger. Evicting on it drops a warm cache to answer a
      // question nobody has asked, on every upload.
      await seed(organizationId, CACHE_SCOPES.documents);

      await fx.publishOn(DOCUMENT_PATTERNS.uploaded, {
        organizationId,
        documentId: faker.string.uuid(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.documents)).toBe(true);
    });
  });

  describe('§4.1 test 1 — a gateway mutation evicts what the next read would hit', () => {
    const agent = () =>
      authenticatedAgent(fx.app, {
        organizationId,
        permissionCodes: ['department.update'],
      });

    const wireDepartment = (id: string) => ({
      id,
      organizationId,
      name: 'Support',
      description: 'Front line',
      memberCount: 0,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });

    it('**`PATCH /departments/:id` drops the departments scope**', async () => {
      const id = faker.string.uuid();

      allowTenant();
      fx.stubs.department.updateDepartment.mockReturnValue(
        of(wireDepartment(id)),
      );

      await seed(organizationId, CACHE_SCOPES.departments);
      expect(await survives(organizationId, CACHE_SCOPES.departments)).toBe(
        true,
      );

      await agent()
        .patch(`${API}/departments/${id}`)
        .send({ name: 'Support (renamed)' })
        .expect(200);

      // No `settle()`: the interceptor awaits the eviction before the response
      // is emitted, precisely so a client that mutates and immediately re-reads
      // cannot observe the pre-write value.
      expect(await survives(organizationId, CACHE_SCOPES.departments)).toBe(
        false,
      );
    });

    it('**and a REJECTED mutation evicts nothing**', async () => {
      // Nothing was written, so there is nothing to evict — and dropping the
      // scope anyway turns every rejected request into a stampede against an
      // origin that just rejected something.
      allowTenant();
      await seed(organizationId, CACHE_SCOPES.departments);

      await agent()
        .patch(`${API}/departments/${faker.string.uuid()}`)
        .send({ name: '' })
        .expect(400);

      expect(await survives(organizationId, CACHE_SCOPES.departments)).toBe(
        true,
      );
    });

    it("and it does not reach another tenant's departments", async () => {
      const id = faker.string.uuid();

      allowTenant();
      fx.stubs.department.updateDepartment.mockReturnValue(
        of(wireDepartment(id)),
      );

      await seed(otherOrganizationId, CACHE_SCOPES.departments);

      await agent()
        .patch(`${API}/departments/${id}`)
        .send({ name: 'Support (renamed)' })
        .expect(200);

      expect(
        await survives(otherOrganizationId, CACHE_SCOPES.departments),
      ).toBe(true);
    });
  });

  describe('§4.2 test 4 — invalidation is tenant-scoped', () => {
    it("**one tenant's write leaves another tenant's entry alone**", async () => {
      await seed(organizationId, CACHE_SCOPES.tickets);
      await seed(otherOrganizationId, CACHE_SCOPES.tickets);

      await fx.publishOn(TICKET_PATTERNS.created, {
        pattern: TICKET_PATTERNS.created,
        organizationId,
        ticketId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.tickets)).toBe(false);
      expect(await survives(otherOrganizationId, CACHE_SCOPES.tickets)).toBe(
        true,
      );
    });

    it('and a scope is not evicted by a neighbouring scope', async () => {
      // `invalidateScope` matches `scope[|:]*`, so `tickets` cannot reach
      // `documents` — nor a hypothetical `tickets-export`.
      await seed(organizationId, CACHE_SCOPES.documents);

      await fx.publishOn(TICKET_PATTERNS.created, {
        pattern: TICKET_PATTERNS.created,
        organizationId,
        ticketId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.documents)).toBe(true);
    });
  });

  describe('§4.2 test 5 — a malformed event does not kill the gateway', () => {
    it('an event with no tenant is survived', async () => {
      // A producer-side bug must not be a gateway outage. If the process died
      // here, every assertion after it would fail as a connection error rather
      // than as itself — so the seeded entry is checked afterwards to prove the
      // consumer is still running.
      await seed(organizationId, CACHE_SCOPES.tickets);

      await fx.publishOn(TICKET_PATTERNS.created, { ticketId: 'no-tenant' });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.tickets)).toBe(true);

      // Still alive, and still evicting.
      await fx.publishOn(TICKET_PATTERNS.created, {
        pattern: TICKET_PATTERNS.created,
        organizationId,
        ticketId: faker.string.uuid(),
        occurredAt: new Date().toISOString(),
      });
      await settle();

      expect(await survives(organizationId, CACHE_SCOPES.tickets)).toBe(false);
    });
  });
});

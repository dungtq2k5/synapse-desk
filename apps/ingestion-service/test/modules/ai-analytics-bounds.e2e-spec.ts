import { ANALYTICS_TOP_N } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  buildTenant,
  createDocument,
  createFlag,
  TenantFixture,
} from '../factories';
import { AiAnalyticsService } from '../../src/modules/analytics/ai-analytics.service';

/**
 * The top-N bound on the gRPC side
 *
 * **This is the door with no `ValidationPipe` in front of it.** The gateway
 * DTOs reject an out-of-range `limit` before dialling, and that is tested at
 * the HTTP boundary — but these methods are reachable from any service over
 * gRPC, where nothing validated anything and proto3 sends `0` for a field the
 * caller omitted. `clampLimit` is the only thing standing between that and an
 * unbounded `take`.
 *
 * It went untested while the bound was written as three separate literals
 * (`1`/`100`/`20` in two gateway DTOs and again here). They are one constant
 * now, `ANALYTICS_TOP_N`, so a widened cap moves every door at once — and these
 * tests are what prove this door is one of them, rather than a fourth copy that
 * merely happens to agree today.
 *
 * The bounds are read FROM the constant deliberately. A literal `100` here
 * would assert that somebody once typed 100, which is not a property worth
 * protecting; what matters is that the service honours whatever the shared
 * constant says.
 */
describe('§4 the AI analytics top-N bound (e2e)', () => {
  let fx: E2eFixture;
  let analytics: AiAnalyticsService;

  let tenant: TenantFixture;

  /** A closed historical range — the flags, not the rollups, are the subject. */
  const RANGE = { from: '2026-01-01', to: '2026-03-31' };

  const caller = (t = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId }, [
      'analytics.read',
    ]);

  /**
   * `count` unresolved flags, all on ONE document.
   *
   * `document_flags` has no unique key on (document, type), and the query pages
   * over flags rather than documents — so one document carrying a hundred flags
   * exercises the same `take` as a hundred documents, without a hundred inserts
   * of a row this test says nothing about.
   */
  const seedFlags = async (count: number) => {
    const document = await createDocument(fx.prisma, tenant);

    for (let index = 0; index < count; index += 1) {
      await createFlag(fx.prisma, document, {
        detail: `Never retrieved (${index})`,
      });
    }

    return document;
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    analytics = fx.moduleRef.get(AiAnalyticsService);
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  describe('knowledge gaps', () => {
    it('1. CAPS a limit above the ceiling instead of running an unbounded take', async () => {
      // The failure this prevents is not a wrong number, it is a query: a
      // caller asking for 10 000 over a tenant with a large flag backlog holds
      // a connection while Postgres serialises every row of it.
      await seedFlags(ANALYTICS_TOP_N.MAX + 5);

      const response = await analytics.getKnowledgeGaps(
        { ...RANGE, limit: ANALYTICS_TOP_N.MAX + 50 },
        caller(),
      );

      expect(response.flags).toHaveLength(ANALYTICS_TOP_N.MAX);
    });

    it('2. Reads ZERO as unset and takes the DEFAULT', async () => {
      // proto3 has no absent int32: a caller that omits `limit` sends 0. Taking
      // that literally returns an empty list, which reads as "no knowledge
      // gaps" — the most reassuring possible way to be wrong.
      await seedFlags(ANALYTICS_TOP_N.DEFAULT + 5);

      const response = await analytics.getKnowledgeGaps(
        { ...RANGE, limit: 0 },
        caller(),
      );

      expect(response.flags).toHaveLength(ANALYTICS_TOP_N.DEFAULT);
    });

    it('3. Honours an in-range limit rather than always defaulting', async () => {
      // The complement of test 2, and what stops `clampLimit` from being
      // "return the default, always" — which would pass test 2 on its own.
      await seedFlags(ANALYTICS_TOP_N.DEFAULT + 5);

      const response = await analytics.getKnowledgeGaps(
        { ...RANGE, limit: 5 },
        caller(),
      );

      expect(response.flags).toHaveLength(5);
    });

    it('4. Never returns another tenant’s flags, whatever the limit', async () => {
      // The bound and the tenant filter are independent, and a `take` raised
      // without a scope is how one becomes the other's problem.
      await seedFlags(3);
      const stranger = buildTenant();
      const theirDocument = await createDocument(fx.prisma, stranger);
      await createFlag(fx.prisma, theirDocument);

      const response = await analytics.getKnowledgeGaps(
        { ...RANGE, limit: ANALYTICS_TOP_N.MAX },
        caller(),
      );

      expect(response.flags).toHaveLength(3);
      expect(
        response.flags.filter((flag) => flag.documentId === theirDocument.id),
      ).toEqual([]);
    });
  });

  describe('document analytics', () => {
    it('5. Applies the SAME bound to every one of its three lists', async () => {
      // `getDocumentAnalytics` slices `mostCited`, `neverRetrieved` and
      // `retrievedNeverCited` by one clamped limit. Asserted through
      // `neverRetrieved` because a freshly created document with no chunks has
      // a retrieval count of zero, which is precisely that list.
      for (let index = 0; index < ANALYTICS_TOP_N.DEFAULT + 3; index += 1) {
        await createDocument(fx.prisma, tenant);
      }

      const response = await analytics.getDocumentAnalytics(
        { limit: 0 },
        caller(),
      );

      expect(response.neverRetrieved).toHaveLength(ANALYTICS_TOP_N.DEFAULT);
    });
  });
});

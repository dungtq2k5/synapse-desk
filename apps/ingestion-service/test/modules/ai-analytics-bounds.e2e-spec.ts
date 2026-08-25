import { ANALYTICS_TOP_N, AiGenerationPurpose } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  buildTenant,
  createDocument,
  createFlag,
  TenantFixture,
} from '../factories';
import { AiAnalyticsService } from '../../src/modules/analytics/ai-analytics.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';

/**
 * The top-N bound on the gRPC side.
 *
 * **This is the door with no `ValidationPipe` in front of it.** The gateway
 * DTOs reject an out-of-range `limit` before dialling, but these methods are
 * reachable from any service over gRPC — where nothing validates and proto3
 * sends `0` for an omitted field. `clampLimit` is the only thing between that
 * and an unbounded `take`.
 *
 * The bounds are read FROM `ANALYTICS_TOP_N` deliberately. A literal `100` here
 * would assert that somebody once typed 100, which is not a property worth
 * protecting; what matters is that the service honours whatever the shared
 * constant says.
 */
describe('The AI analytics top-N bound (e2e)', () => {
  let fx: E2eFixture;
  let analytics: AiAnalyticsService;
  let getAiEntitlement: jest.SpyInstance;

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

    // auth-service is not running for this suite, and `getAiUsage` reads the
    // entitlement to report the budget alongside the spend. It FAILS CLOSED
    // without one, which is correct and is asserted elsewhere.
    getAiEntitlement = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'getAiEntitlement',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
    getAiEntitlement.mockResolvedValue({
      budgetMicros: 10_000_000n,
      billingCycleStart: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  afterAll(() => fx.close());

  describe('knowledge gaps', () => {
    it('1. CAPS a limit above the ceiling instead of running an unbounded take', async () => {
      // The failure this prevents is not a wrong number, it is a query: a
      // caller asking for 10 000 over a tenant with a large flag backlog holds
      // a connection while Postgres serializes every row of it.
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

    /**
     * Doc 56 §E — the rate, not the flags.
     *
     * Written against `ai_generation_daily_stats` directly rather than through
     * the rollup, because what is under test is the READ: which population the
     * phrase "empty retrieval rate" is computed over. The rollup's own split is
     * asserted in `ai-rollup.e2e-spec`.
     */
    describe('attachment-grounded answers', () => {
      const stats = (overrides: Record<string, unknown>) =>
        fx.prisma.aiGenerationDailyStat.create({
          data: {
            organizationId: tenant.organizationId,
            day: new Date('2026-02-01T00:00:00.000Z'),
            purpose: AiGenerationPurpose.CHAT_ANSWER,
            // Not a real model name: `check-model-literals` refuses one outside
            // the settings layer, and this row's model is a dimension the test
            // says nothing about. `ai-rollup.e2e-spec` uses the same stand-in.
            modelName: 'model-under-test',
            generations: 10,
            emptyRetrievals: 0,
            attachmentGenerations: 0,
            attachmentEmptyRetrievals: 0,
            ...overrides,
          },
        });

      it('**6. an attachment-grounded answer does NOT raise the empty-retrieval rate**', async () => {
        // Ten answering generations. Four retrieved nothing, and all four were
        // answering a question about a file the user attached — which the
        // corpus was never expected to answer.
        //
        // The old rate said 40% and was read as "the knowledge base is failing
        // two questions in five". The population the phrase describes is the
        // six attachment-free ones, none of which came up empty.
        await stats({
          generations: 10,
          emptyRetrievals: 4,
          attachmentGenerations: 4,
          attachmentEmptyRetrievals: 4,
        });

        const response = await analytics.getKnowledgeGaps(
          { ...RANGE, limit: ANALYTICS_TOP_N.DEFAULT },
          caller(),
        );

        expect(response.emptyRetrievalRate?.rate).toBe(0);
        expect(response.emptyRetrievalRate?.numerator).toBe(0);
        expect(response.emptyRetrievalRate?.denominator).toBe(6);
        // The TOTAL is unchanged, so the exclusion is visible rather than
        // silently rewriting a number somebody was already watching.
        expect(response.emptyRetrievals).toBe(4);
      });

      it('**7. …and IS counted in the attachment-grounded slice**', async () => {
        // The pair, and the reason 6 alone is not enough. A change that simply
        // DROPPED attachment-grounded generations from this report would pass
        // test 6 and pass silently — nothing else counts them, so "the corpus
        // is being routed around" would become invisible at exactly the moment
        // it started happening.
        await stats({
          generations: 10,
          emptyRetrievals: 4,
          attachmentGenerations: 4,
          attachmentEmptyRetrievals: 4,
        });

        const response = await analytics.getKnowledgeGaps(
          { ...RANGE, limit: ANALYTICS_TOP_N.DEFAULT },
          caller(),
        );

        expect(response.attachmentGroundedRate?.numerator).toBe(4);
        expect(response.attachmentGroundedRate?.denominator).toBe(10);
        expect(response.attachmentEmptyRetrievals).toBe(4);
      });

      it('**8. a corpus gap with no attachment still reads as a gap**', async () => {
        // The other direction, and what stops the fix erasing the metric. If
        // the empty retrieval had nothing to do with an attachment, the rate
        // must still report it — otherwise §E would have replaced a metric that
        // over-counted with one that counts nothing.
        await stats({
          generations: 10,
          emptyRetrievals: 4,
          attachmentGenerations: 0,
          attachmentEmptyRetrievals: 0,
        });

        const response = await analytics.getKnowledgeGaps(
          { ...RANGE, limit: ANALYTICS_TOP_N.DEFAULT },
          caller(),
        );

        expect(response.emptyRetrievalRate?.numerator).toBe(4);
        expect(response.emptyRetrievalRate?.denominator).toBe(10);
      });

      it('**9. `getAiUsage` publishes the SAME population under the same name**', async () => {
        // Two endpoints publish `emptyRetrievalRate`. Fixing one and not the
        // other leaves two dashboards disagreeing under one field name, which
        // reads as broken data rather than as two definitions — and is worse
        // than not fixing it at all.
        await stats({
          generations: 10,
          emptyRetrievals: 4,
          attachmentGenerations: 4,
          attachmentEmptyRetrievals: 4,
        });

        const usage = await analytics.getAiUsage({ ...RANGE }, caller());

        expect(usage.emptyRetrievalRate?.numerator).toBe(0);
        expect(usage.emptyRetrievalRate?.denominator).toBe(6);
      });
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

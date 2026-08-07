import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { ANALYTICS_TOP_N } from '@synapsedesk/common';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * The analytics surface at the HTTP boundary — 19-doc §3, §4.
 *
 * The owning services are stubbed: the rollup arithmetic, the definitions and
 * the timezone bucketing all have their own suites against real databases. What
 * is under test here is what only exists at this layer — **the cache key**, the
 * **partial-failure shape** for the cross-service endpoints, and that every
 * rate reaches a client with its denominator.
 */
describe('§4 Analytics at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const agentId = faker.string.uuid();
  const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

  const FROM = '2026-01-01';
  const TO = '2026-03-31';

  /** A closed historical range — nothing can change it but a backfill. */
  const CLOSED_RANGE = `from=${FROM}&to=${TO}`;

  const wireRate = (numerator: number, denominator: number) => ({
    rate: denominator > 0 ? numerator / denominator : undefined,
    numerator,
    denominator,
  });

  const wireMean = (mean: number | undefined, count: number) => ({
    mean,
    count,
  });

  const stubOverview = (overrides: Record<string, unknown> = {}) =>
    fx.stubs.analytics.getOverview.mockReturnValue(
      of({
        ticketsCreated: 120,
        ticketsResolved: 100,
        ticketsEscalated: 12,
        openTickets: 20,
        deflection: wireRate(70, 100),
        csat: wireRate(9, 10),
        humanFirstResponseSeconds: wireMean(3600, 40),
        aiFirstResponseSeconds: wireMean(2, 60),
        resolutionSeconds: wireMean(86_400, 100),
        openTicketMedianAgeSeconds: 172_800,
        computedAt: timestamp(),
        ...overrides,
      }),
    );

  /**
   * The SAME tenant every time.
   *
   * `authenticatedAgent` mints a fresh `organizationId` per call by default, and
   * the tenant id is the first segment of every cache key — so without pinning
   * it, every cache test would pass by never sharing an entry at all, which is
   * the opposite of what they claim to check.
   */
  const agent = () =>
    authenticatedAgent(fx.app, {
      organizationId: ORGANIZATION_ID,
      permissionCodes: ['analytics.read'],
    });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    // The analytics cache lives in the same Redis the throttler uses, so a
    // flush between tests is what keeps one test's answer out of the next.
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await fx.close();
  });

  describe('access', () => {
    it('1. Requires `analytics.read`', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/analytics/overview?${CLOSED_RANGE}`);

      expect(res.status).toBe(403);
    });

    it('2. Sends NO organization id — the tenant travels in metadata', async () => {
      // The structural version of tenant scoping: there is no request field a
      // caller could set to read another tenant's dashboard.
      stubOverview();

      await agent().get(`${API}/analytics/overview?${CLOSED_RANGE}`);

      const [request] = fx.stubs.analytics.getOverview.mock.calls[0];
      expect(Object.keys(request)).not.toContain('organizationId');
    });
  });

  describe('the range filter', () => {
    it('3. Rejects a malformed date before dialling the service', async () => {
      const res = await agent().get(
        `${API}/analytics/overview?from=last-tuesday&to=${TO}`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.analytics.getOverview).not.toHaveBeenCalled();
    });

    it('4. Rejects an unknown granularity', async () => {
      const res = await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}&granularity=FORTNIGHT`,
      );

      expect(res.status).toBe(400);
    });

    it('5. Forwards the department filter', async () => {
      // The agreement check's other half: `?departmentId=` has to reach the
      // rollup, or it silently answers the tenant-wide question instead.
      stubOverview();
      const departmentId = faker.string.uuid();

      await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}&departmentId=${departmentId}`,
      );

      expect(fx.stubs.analytics.getOverview).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId }),
        expect.anything(),
      );
    });
  });

  describe('the top-N bound', () => {
    // `ANALYTICS_TOP_N` replaced three literal copies of the same 1/100/20 —
    // two DTOs here and `ai-analytics.service`'s own clamp, which is the copy
    // with no ValidationPipe in front of it. Nothing asserted any of them, so
    // widening the cap in one place and not the others would have been silent.
    // One constant now, so these tests cover all three doors.
    const gaps = () =>
      fx.stubs.ledger.getKnowledgeGaps.mockReturnValue(
        of({
          emptyRetrievals: 0,
          answeringGenerations: 0,
          emptyRetrievalRate: wireRate(0, 0),
          flags: [],
        }),
      );

    it('5a. Refuses a limit ABOVE the cap rather than clamping it quietly', async () => {
      // Rejected, not clamped: a caller asking for 500 and silently receiving
      // 100 believes it has the whole list, and pages of a truncated list are
      // how a "top offenders" dashboard omits the actual worst offender.
      gaps();

      const res = await agent().get(
        `${API}/analytics/knowledge-gaps?${CLOSED_RANGE}&limit=${ANALYTICS_TOP_N.MAX + 1}`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.ledger.getKnowledgeGaps).not.toHaveBeenCalled();
    });

    it('5b. Refuses a limit BELOW the floor', async () => {
      gaps();

      const res = await agent().get(
        `${API}/analytics/knowledge-gaps?${CLOSED_RANGE}&limit=0`,
      );

      expect(res.status).toBe(400);
    });

    it('5c. Applies the DEFAULT when the caller omits it', async () => {
      // The default has to reach the service, not merely exist on the DTO: an
      // omitted `limit` arriving as `undefined` would hand the service a
      // proto3 zero, which its own clamp reads as "unset" — the same number by
      // luck rather than by agreement.
      gaps();

      await agent().get(`${API}/analytics/knowledge-gaps?${CLOSED_RANGE}`);

      expect(fx.stubs.ledger.getKnowledgeGaps).toHaveBeenCalledWith(
        expect.objectContaining({ limit: ANALYTICS_TOP_N.DEFAULT }),
        expect.anything(),
      );
    });

    it('5d. Accepts a limit AT the cap — the bound is inclusive', async () => {
      gaps();

      const res = await agent().get(
        `${API}/analytics/knowledge-gaps?${CLOSED_RANGE}&limit=${ANALYTICS_TOP_N.MAX}`,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('rates carry their denominators', () => {
    it('6. Every rate reaches the client with numerator and denominator', async () => {
      // **A percentage with a hidden denominator is how "our CSAT is 100%"
      // gets into a board deck on two responses.**
      stubOverview();

      const res = await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}`,
      );

      expect(res.body.data.deflection).toEqual({
        rate: 0.7,
        numerator: 70,
        denominator: 100,
      });
      expect(res.body.data.csat).toMatchObject({
        numerator: 9,
        denominator: 10,
      });
    });

    it('7. An EMPTY range returns zeros and a NULL rate, not an error', async () => {
      // `null` rather than `0`: "nobody rated anything" and "everybody rated it
      // negative" are different facts, and rendering the first as 0% is a wrong
      // answer rather than a missing one. A dashboard that 500s for a quiet
      // tenant is the first thing a new customer sees.
      stubOverview({
        ticketsCreated: 0,
        ticketsResolved: 0,
        ticketsEscalated: 0,
        openTickets: 0,
        deflection: wireRate(0, 0),
        csat: wireRate(0, 0),
        humanFirstResponseSeconds: wireMean(undefined, 0),
        aiFirstResponseSeconds: wireMean(undefined, 0),
        resolutionSeconds: wireMean(undefined, 0),
        openTicketMedianAgeSeconds: undefined,
        computedAt: undefined,
      });

      const res = await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.deflection.rate).toBeNull();
      expect(res.body.data.deflection.denominator).toBe(0);
      expect(res.body.data.humanFirstResponseSeconds.mean).toBeNull();
      expect(res.body.data.computedAt).toBeNull();
    });

    it('8. **Human and AI first response arrive as SEPARATE fields**', async () => {
      // The metric-measuring-itself guard, at the boundary: a single blended
      // figure would improve whenever AI usage rose, and no client could
      // un-blend it.
      stubOverview();

      const res = await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}`,
      );

      expect(res.body.data.humanFirstResponseSeconds.mean).toBe(3600);
      expect(res.body.data.aiFirstResponseSeconds.mean).toBe(2);
      expect(res.body.data).not.toHaveProperty('firstResponseSeconds');
    });

    it('9. Reports open-ticket median age beside the resolution mean', async () => {
      // The honest counterweight: `resolutionSeconds` can only see tickets that
      // closed, so it is biased optimistic — a ticket open for 40 days is
      // invisible to it.
      stubOverview();

      const res = await agent().get(
        `${API}/analytics/overview?${CLOSED_RANGE}`,
      );

      expect(res.body.data.openTicketMedianAgeSeconds).toBe(172_800);
    });
  });

  describe('caching', () => {
    it('10. Reordered query params hit the SAME cache entry', async () => {
      // A URL key would halve the hit rate for free, and do it invisibly.
      stubOverview();

      await agent().get(`${API}/analytics/overview?from=${FROM}&to=${TO}`);
      await agent().get(`${API}/analytics/overview?to=${TO}&from=${FROM}`);

      expect(fx.stubs.analytics.getOverview).toHaveBeenCalledTimes(1);
    });

    it('11. A different tenant NEVER hits another tenant’s entry', async () => {
      // **The worst possible cache bug in a multi-tenant system, and the
      // cheapest to prevent** — the tenant id is the first segment of the key,
      // so a cross-tenant hit is unreachable rather than merely unlikely.
      //
      // The mirror of test 10: identical question, different tenants, and the
      // service is asked TWICE. If those two ever collapsed into one call, one
      // tenant would be reading the other's dashboard.
      stubOverview();

      await authenticatedAgent(fx.app, {
        organizationId: faker.string.uuid(),
        permissionCodes: ['analytics.read'],
      }).get(`${API}/analytics/overview?${CLOSED_RANGE}`);

      await authenticatedAgent(fx.app, {
        organizationId: faker.string.uuid(),
        permissionCodes: ['analytics.read'],
      }).get(`${API}/analytics/overview?${CLOSED_RANGE}`);

      expect(fx.stubs.analytics.getOverview).toHaveBeenCalledTimes(2);
    });

    it('12. A different RANGE is a different entry', async () => {
      stubOverview();

      await agent().get(`${API}/analytics/overview?from=${FROM}&to=${TO}`);
      await agent().get(`${API}/analytics/overview?from=${FROM}&to=2026-02-28`);

      expect(fx.stubs.analytics.getOverview).toHaveBeenCalledTimes(2);
    });

    it('13. A different ENDPOINT is a different entry', async () => {
      stubOverview();
      fx.stubs.analytics.getDeflection.mockReturnValue(
        of({ points: [], total: wireRate(0, 0) }),
      );

      await agent().get(`${API}/analytics/overview?${CLOSED_RANGE}`);
      await agent().get(`${API}/analytics/deflection?${CLOSED_RANGE}`);

      expect(fx.stubs.analytics.getOverview).toHaveBeenCalledTimes(1);
      expect(fx.stubs.analytics.getDeflection).toHaveBeenCalledTimes(1);
    });
  });

  describe('partial failure on the cross-service endpoints', () => {
    const stubAgentStats = () =>
      fx.stubs.analytics.getAgentStats.mockReturnValue(
        of({
          items: [
            {
              agentId,
              assigned: 10,
              resolved: 8,
              messagesSent: 40,
              resolutionSeconds: wireMean(7200, 8),
            },
          ],
        }),
      );

    const stubLedgerUsage = () =>
      fx.stubs.ledger.getAiUsage.mockReturnValue(
        of({
          points: [],
          byPurpose: [],
          byModel: [],
          totalCostMicros: 0,
          totalGenerations: 0,
          monthlyBudgetMicros: 1_000_000,
          aiModelTier: 'FAST',
          draftAcceptance: wireRate(6, 10),
          emptyRetrievalRate: wireRate(1, 20),
          computedAt: undefined,
        }),
      );

    const stubNames = () =>
      fx.stubs.user.listUsersByIds.mockReturnValue(
        of({
          items: [{ userId: agentId, email: 'a@t.test', fullName: 'Ada' }],
        }),
      );

    it('14. Joins all three legs and hydrates the name', async () => {
      stubAgentStats();
      stubLedgerUsage();
      stubNames();

      const res = await agent().get(`${API}/analytics/agents?${CLOSED_RANGE}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({
        agentId,
        fullName: 'Ada',
        resolved: 8,
      });
      expect(res.body.data.items[0].draftAcceptance.denominator).toBe(10);
      expect(res.body.data.unavailable).toEqual([]);
    });

    it('15. **One service down → partial data marked `unavailable`, not a 500**', async () => {
      // A dashboard where nine tiles render and one names the service that is
      // down is far more useful than a 500 — and it is what somebody
      // diagnosing an incident actually needs.
      stubAgentStats();
      stubNames();
      fx.stubs.ledger.getAiUsage.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAVAILABLE, 'ingestion-service is down'),
        ),
      );

      const res = await agent().get(`${API}/analytics/agents?${CLOSED_RANGE}`);

      expect(res.status).toBe(200);
      // The leg that answered is still there, whole.
      expect(res.body.data.items[0].resolved).toBe(8);
      // The one that did not is named rather than silently zeroed.
      expect(res.body.data.items[0].draftAcceptance).toBeNull();
      expect(res.body.data.unavailable).toEqual([
        expect.objectContaining({ source: 'ingestion-service' }),
      ]);
    });

    it('16. A failed NAME lookup costs the names, not the numbers', async () => {
      // A display name is decoration. Losing it must not empty the figures
      // somebody is actually reading.
      stubAgentStats();
      stubLedgerUsage();
      fx.stubs.user.listUsersByIds.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'auth is down')),
      );

      const res = await agent().get(`${API}/analytics/agents?${CLOSED_RANGE}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].resolved).toBe(8);
      expect(res.body.data.items[0].fullName).toBeNull();
      expect(res.body.data.unavailable).toEqual([
        expect.objectContaining({ source: 'auth-service' }),
      ]);
    });

    it('17. An EMPTY agent list costs no name lookup at all', async () => {
      fx.stubs.analytics.getAgentStats.mockReturnValue(of({ items: [] }));
      stubLedgerUsage();

      const res = await agent().get(`${API}/analytics/agents?${CLOSED_RANGE}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(fx.stubs.user.listUsersByIds).not.toHaveBeenCalled();
    });

    it('18. `knowledge-gaps` degrades the same way', async () => {
      fx.stubs.ledger.getKnowledgeGaps.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'down')),
      );

      const res = await agent().get(
        `${API}/analytics/knowledge-gaps?${CLOSED_RANGE}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toEqual([]);
      expect(res.body.data.unavailable).toHaveLength(1);
    });

    it('19. `documents` keeps UNRETRIEVED and UNCITED as separate lists', async () => {
      // **Two DIFFERENT findings** (RDM Table 27). A document nobody's question
      // came near may just be mis-titled; one retrieved twenty times and cited
      // never is displacing the sources that would have answered — and folding
      // them into one "unused" list is how the second hides inside the first.
      fx.stubs.ledger.getDocumentAnalytics.mockReturnValue(
        of({
          mostCited: [],
          neverRetrieved: [
            {
              documentId: faker.string.uuid(),
              title: 'Never found',
              retrievalCount: 0,
              citationCount: 0,
              chunkCount: 3,
            },
          ],
          retrievedNeverCited: [
            {
              documentId: faker.string.uuid(),
              title: 'Found and ignored',
              retrievalCount: 40,
              citationCount: 0,
              chunkCount: 5,
            },
          ],
        }),
      );
      fx.stubs.analytics.getSatisfaction.mockReturnValue(
        of({
          points: [],
          csatTotal: wireRate(0, 0),
          citationAccuracyTotal: wireRate(8, 10),
        }),
      );

      const res = await agent().get(`${API}/analytics/documents`);

      expect(res.status).toBe(200);
      expect(res.body.data.neverRetrieved).toHaveLength(1);
      expect(res.body.data.retrievedNeverCited).toHaveLength(1);
      expect(res.body.data.citationAccuracy.denominator).toBe(10);
    });

    it('20. `documents` still lists documents when the CSAT leg is down', async () => {
      // A Knowledge Manager looking at "which documents are never cited" is not
      // helped by a 500 because the feedback service is restarting.
      fx.stubs.ledger.getDocumentAnalytics.mockReturnValue(
        of({ mostCited: [], neverRetrieved: [], retrievedNeverCited: [] }),
      );
      fx.stubs.analytics.getSatisfaction.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'down')),
      );

      const res = await agent().get(`${API}/analytics/documents`);

      expect(res.status).toBe(200);
      expect(res.body.data.citationAccuracy).toBeNull();
      expect(res.body.data.unavailable).toEqual([
        expect.objectContaining({ source: 'ticket-service' }),
      ]);
    });
  });

  describe('ai-usage', () => {
    it('21. Carries the per-purpose split and the budget beside the spend', async () => {
      // **The per-purpose split is the point**: it shows a tenant where the
      // budget actually goes, which is rarely where they assume. And a cost
      // with no ceiling beside it is a number nobody can act on.
      fx.stubs.ledger.getAiUsage.mockReturnValue(
        of({
          points: [{ day: '2026-01-01', generations: 10, costMicros: 500 }],
          byPurpose: [
            {
              purpose: 'EMBEDDING',
              modelName: '',
              generations: 900,
              promptTokens: 90_000,
              completionTokens: 0,
              costMicros: 4_000,
              latencyMs: wireMean(120, 900),
              failureRate: wireRate(0, 900),
            },
          ],
          byModel: [],
          totalCostMicros: 4_500,
          totalGenerations: 910,
          monthlyBudgetMicros: 1_000_000,
          aiModelTier: 'BALANCED',
          draftAcceptance: wireRate(6, 10),
          emptyRetrievalRate: wireRate(1, 20),
          computedAt: timestamp(),
        }),
      );

      const res = await agent().get(
        `${API}/analytics/ai-usage?${CLOSED_RANGE}`,
      );

      expect(res.body.data.byPurpose[0].purpose).toBe('EMBEDDING');
      expect(res.body.data.monthlyBudgetMicros).toBe(1_000_000);
      expect(res.body.data.aiModelTier).toBe('BALANCED');
      expect(res.body.data.draftAcceptance.denominator).toBe(10);
    });
  });

  describe('export — 19-doc §5', () => {
    const exportId = faker.string.uuid();

    const wireExport = (overrides: Record<string, unknown> = {}) => ({
      id: exportId,
      status: 'PENDING',
      kind: 'TICKET_DAILY',
      rowCount: undefined,
      rollupComputedAt: undefined,
      downloadUrl: undefined,
      error: undefined,
      createdAt: timestamp(),
      completedAt: undefined,
      ...overrides,
    });

    it('24. Answers 202 with a job id — the file appears later', async () => {
      fx.stubs.analytics.createExport.mockReturnValue(of(wireExport()));

      const res = await agent()
        .post(`${API}/analytics/export`)
        .send({ kind: 'TICKET_DAILY', from: FROM, to: TO });

      expect(res.status).toBe(202);
      expect(res.body.data.id).toBe(exportId);
      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.downloadUrl).toBeNull();
    });

    it('25. Rejects an unknown kind before dialling the service', async () => {
      const res = await agent()
        .post(`${API}/analytics/export`)
        .send({ kind: 'EVERYTHING', from: FROM, to: TO });

      expect(res.status).toBe(400);
      expect(fx.stubs.analytics.createExport).not.toHaveBeenCalled();
    });

    it('26. Carries the URL and the ROLLUP RUN once ready', async () => {
      // The disputed-number guard reaching the client: two exports of "last
      // quarter" that disagree are explainable in ten seconds rather than
      // being an argument.
      fx.stubs.analytics.getExport.mockReturnValue(
        of(
          wireExport({
            status: 'READY',
            rowCount: 90,
            rollupComputedAt: timestamp(),
            downloadUrl: 'https://storage.example/signed-get',
            completedAt: timestamp(),
          }),
        ),
      );

      const res = await agent().get(`${API}/analytics/export/${exportId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBe(
        'https://storage.example/signed-get',
      );
      expect(res.body.data.rollupComputedAt).not.toBeNull();
      expect(res.body.data.rowCount).toBe(90);
    });

    it('27. A FAILED export reports the error rather than a URL', async () => {
      // An empty CSV reads as "no data", which is a wrong answer rather than an
      // error — so failure has to reach the client as failure.
      fx.stubs.analytics.getExport.mockReturnValue(
        of(
          wireExport({
            status: 'FAILED',
            error: 'storage is down',
            completedAt: timestamp(),
          }),
        ),
      );

      const res = await agent().get(`${API}/analytics/export/${exportId}`);

      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.error).toBe('storage is down');
      expect(res.body.data.downloadUrl).toBeNull();
    });

    it('28. Another tenant’s job id surfaces as 404', async () => {
      fx.stubs.analytics.getExport.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No export with that id'),
        ),
      );

      const res = await agent().get(`${API}/analytics/export/${exportId}`);

      expect(res.status).toBe(404);
    });

    it('29. Polling is NOT cached — a spinner must be able to resolve', async () => {
      fx.stubs.analytics.getExport.mockReturnValue(of(wireExport()));

      await agent().get(`${API}/analytics/export/${exportId}`);
      await agent().get(`${API}/analytics/export/${exportId}`);

      expect(fx.stubs.analytics.getExport).toHaveBeenCalledTimes(2);
    });
  });

  describe('what does NOT exist', () => {
    it('22. There is no write endpoint under /analytics', async () => {
      // Analytics is a read projection. The one write-shaped operation — the
      // rollup — is platform-operated and deliberately not routed for a tenant,
      // because a backfill recomputes numbers a customer may already have
      // exported.
      const res = await agent().post(`${API}/analytics/overview`).send({});

      expect(res.status).toBe(404);
    });

    it('23. There is no rollup trigger', async () => {
      const res = await agent().post(`${API}/analytics/rollup`).send({});

      expect(res.status).toBe(404);
    });
  });
});

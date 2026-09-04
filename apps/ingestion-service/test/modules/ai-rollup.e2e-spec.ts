import {
  AiGenerationPurpose,
  AiGenerationStatus,
  AiGenerationOutcome,
  compareAlphabetically,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { buildTenant, TenantFixture } from '../factories';
import { AiGenerationRollupJob } from '../../src/modules/analytics/ai-generation-rollup.job';
import { ChunkUsageProjection } from '../../src/modules/scheduled/chunk-usage.projection';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';

/**
 * The AI rollup.
 *
 * **This one is not an optimisation, it is the only durable record.**
 * `ai_generations` is retention-rolled (RDM Table 29), so every figure here
 * becomes unrecoverable the moment retention runs over the same window — which
 * makes test 14, the under-reporting one, the most consequential test in the
 * file even though it looks like bookkeeping.
 */
describe('The AI generation rollup (e2e)', () => {
  let fx: E2eFixture;
  let rollup: AiGenerationRollupJob;
  let listOrganizationTimezones: jest.SpyInstance;

  let tenant: TenantFixture;

  const SAIGON = 'Asia/Ho_Chi_Minh';
  const MODEL = 'model-under-test';

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    rollup = fx.moduleRef.get(AiGenerationRollupJob);

    listOrganizationTimezones = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listOrganizationTimezones',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    tenant = buildTenant();
    listOrganizationTimezones.mockResolvedValue(new Map());
  });

  afterAll(() => fx.close());

  const at = (iso: string) => new Date(iso);

  const generation = (overrides: Record<string, unknown> = {}) =>
    fx.prisma.aiGeneration.create({
      data: {
        organizationId: tenant.organizationId,
        purpose: AiGenerationPurpose.CHAT_ANSWER,
        modelName: MODEL,
        promptTokens: 1_000,
        completionTokens: 500,
        estimatedCostMicros: 250n,
        latencyMs: 900,
        status: AiGenerationStatus.SUCCESS,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        ...overrides,
      },
    });

  const runOver = (from: string, to: string) =>
    rollup.backfill(at(`${from}T00:00:00.000Z`), at(`${to}T00:00:00.000Z`));

  const statsFor = (day: string) =>
    fx.prisma.aiGenerationDailyStat.findMany({
      where: { day: at(`${day}T00:00:00.000Z`) },
      orderBy: { purpose: 'asc' },
    });

  describe('idempotency and backfill', () => {
    it('1. Re-running the same day does not double the counters', async () => {
      await generation();
      await generation();

      await runOver('2026-03-01', '2026-03-04');
      await runOver('2026-03-01', '2026-03-04');

      const rows = await statsFor('2026-03-02');
      expect(rows).toHaveLength(1);
      expect(rows[0].generations).toBe(2);
      expect(Number(rows[0].costMicros)).toBe(500);
    });

    it('2. A backfill matches day-by-day runs', async () => {
      // The ONLY window in which a bug in this job can ever be corrected: once
      // retention has eaten the raw rows there is nothing left to recompute
      // from.
      for (const day of ['01', '02', '03']) {
        await generation({ createdAt: at(`2026-03-${day}T09:00:00.000Z`) });
      }

      for (const day of ['01', '02', '03']) {
        await runOver(`2026-03-${day}`, `2026-03-${day}`);
      }
      const perDay = await fx.prisma.aiGenerationDailyStat.findMany({
        orderBy: { day: 'asc' },
      });

      await runOver('2026-02-25', '2026-03-10');
      const backfilled = await fx.prisma.aiGenerationDailyStat.findMany({
        orderBy: { day: 'asc' },
      });

      expect(perDay).toHaveLength(3);
      expect(backfilled.map((row) => row.generations)).toEqual(
        perDay.map((row) => row.generations),
      );
    });

    it('3. A quiet tenant produces no rows', async () => {
      const outcome = await runOver('2026-03-01', '2026-03-31');

      expect(outcome.tenants).toBe(0);
      await expect(fx.prisma.aiGenerationDailyStat.count()).resolves.toBe(0);
    });
  });

  describe('the dimensions and counters', () => {
    it('4. Splits by PURPOSE and by MODEL', async () => {
      // **The per-purpose split is the point**: it shows a tenant where the
      // budget actually goes, which is rarely where they assume.
      await generation({ purpose: AiGenerationPurpose.CHAT_ANSWER });
      await generation({ purpose: AiGenerationPurpose.EMBEDDING });
      await generation({
        purpose: AiGenerationPurpose.CHAT_ANSWER,
        modelName: 'another-model',
      });

      await runOver('2026-03-01', '2026-03-04');

      const rows = await statsFor('2026-03-02');
      expect(rows).toHaveLength(3);
      expect(
        rows
          .map((row) => `${row.purpose}:${row.modelName}`)
          .sort(compareAlphabetically),
      ).toEqual(
        [
          `${AiGenerationPurpose.CHAT_ANSWER}:another-model`,
          `${AiGenerationPurpose.CHAT_ANSWER}:${MODEL}`,
          `${AiGenerationPurpose.EMBEDDING}:${MODEL}`,
        ].sort(compareAlphabetically),
      );
    });

    it('5. Sums tokens, cost and latency — with the latency COUNT beside it', async () => {
      await generation({ latencyMs: 800 });
      await generation({ latencyMs: 1_200 });
      // A row with no latency recorded: counted as a generation and NOT as a
      // latency sample, so the mean is over what was actually measured.
      await generation({ latencyMs: null });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.generations).toBe(3);
      expect(Number(row.promptTokens)).toBe(3_000);
      expect(Number(row.latencyMsSum)).toBe(2_000);
      expect(row.latencyCount).toBe(2);
    });

    it('6. Counts FAILURES without counting them as latency samples', async () => {
      await generation({ status: AiGenerationStatus.FAILED, latencyMs: null });
      await generation();

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.failures).toBe(1);
      expect(row.generations).toBe(2);
    });

    it('7. **Counts EMPTY RETRIEVALS — the knowledge-gap signal**', async () => {
      // A generation that retrieved nothing is a question the corpus could not
      // answer: a content backlog item rather than an error, and invisible in
      // every other counter here.
      await generation({ retrievedChunkIds: [] });
      await generation({
        retrievedChunkIds: ['11111111-1111-4111-8111-111111111111'],
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.emptyRetrievals).toBe(1);
    });

    it('8. Does NOT count an embedding as an empty retrieval', async () => {
      // An embedding retrieves nothing by definition. Counting it would make
      // the knowledge-gap rate track ingestion volume rather than corpus
      // coverage — a number that rises when you upload documents.
      await generation({
        purpose: AiGenerationPurpose.EMBEDDING,
        retrievedChunkIds: [],
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.emptyRetrievals).toBe(0);
    });

    it('**8b. An attachment-grounded empty retrieval is SPLIT OUT, not dropped**', async () => {
      // The count is not factually wrong — retrieval ran and
      // returned nothing — but the INFERENCE is: `emptyRetrievalRate` is read
      // as "the corpus is failing to answer questions it should answer", and a
      // customer asking about their own invoice is asking something the corpus
      // was never expected to answer.
      //
      // **`emptyRetrievals` stays the TOTAL**, so the two numbers read
      // together. Reporting only the attachment-free count here would make the
      // slice invisible in the one table that could show it.
      await generation({ retrievedChunkIds: [], attachmentCount: 1 });
      await generation({ retrievedChunkIds: [], attachmentCount: 0 });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.emptyRetrievals).toBe(2);
      expect(row.attachmentEmptyRetrievals).toBe(1);
      expect(row.attachmentGenerations).toBe(1);
    });

    it('**8c. …and an attachment that RETRIEVED something is still counted as grounded**', async () => {
      // The pair that stops 8b passing for a change which simply copied
      // `emptyRetrievals` into both columns. `attachmentGenerations` is the
      // POPULATION — every answering generation that was given a file — and
      // `attachmentEmptyRetrievals` is the subset of it that retrieved nothing.
      // Conflating them makes the attachment-free rate wrong in the other
      // direction.
      await generation({
        retrievedChunkIds: ['11111111-1111-4111-8111-111111111111'],
        attachmentCount: 2,
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.attachmentGenerations).toBe(1);
      expect(row.attachmentEmptyRetrievals).toBe(0);
      expect(row.emptyRetrievals).toBe(0);
    });

    it('**8d. An EMBEDDING with attachments is in neither attachment column**', async () => {
      // The same purpose filter as the total above, for the same reason: an
      // embedding retrieves nothing by definition, and letting it into either
      // attachment column would make the split track ingestion volume.
      await generation({
        purpose: AiGenerationPurpose.EMBEDDING,
        retrievedChunkIds: [],
        attachmentCount: 3,
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.attachmentGenerations).toBe(0);
      expect(row.attachmentEmptyRetrievals).toBe(0);
    });

    it('9. Counts every draft OUTCOME, including DISCARDED', async () => {
      // The denominator's third term, and the one that depends on the sweep.
      // Without it acceptance divides by drafts that were USED
      // and reports ~100% regardless of quality.
      await generation({
        purpose: AiGenerationPurpose.DRAFT,
        outcome: AiGenerationOutcome.ACCEPTED,
      });
      await generation({
        purpose: AiGenerationPurpose.DRAFT,
        outcome: AiGenerationOutcome.EDITED,
      });
      await generation({
        purpose: AiGenerationPurpose.DRAFT,
        outcome: AiGenerationOutcome.DISCARDED,
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.draftsAccepted).toBe(1);
      expect(row.draftsEdited).toBe(1);
      expect(row.draftsDiscarded).toBe(1);
    });

    it('10. Buckets in the TENANT’s timezone', async () => {
      listOrganizationTimezones.mockResolvedValue(
        new Map([[tenant.organizationId, SAIGON]]),
      );
      await generation({ createdAt: at('2026-03-09T18:00:00.000Z') });

      await runOver('2026-03-08', '2026-03-11');

      const rows = await fx.prisma.aiGenerationDailyStat.findMany();
      // 18:00 UTC on the 9th is 01:00 on the TENTH in Saigon.
      expect(rows[0].day.toISOString().slice(0, 10)).toBe('2026-03-10');
    });

    it('11. Keeps tenants apart', async () => {
      const other = buildTenant();
      await generation();
      await fx.prisma.aiGeneration.create({
        data: {
          organizationId: other.organizationId,
          purpose: AiGenerationPurpose.CHAT_ANSWER,
          modelName: MODEL,
          createdAt: at('2026-03-02T09:00:00.000Z'),
        },
      });

      await runOver('2026-03-01', '2026-03-04');

      const mine = await fx.prisma.aiGenerationDailyStat.findMany({
        where: { organizationId: tenant.organizationId },
      });
      expect(mine).toHaveLength(1);
      expect(mine[0].generations).toBe(1);
    });

    it('12. Stores no averaged column', async () => {
      const columns = await fx.prisma.$queryRawUnsafe<
        { column_name: string }[]
      >(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ai_generation_daily_stats'`,
      );
      const names = columns.map((column) => column.column_name);

      expect(names).toEqual(
        expect.arrayContaining(['latency_ms_sum', 'latency_count']),
      );
      expect(
        names.filter((name) => /_avg$|^avg_|_average|_mean|_rate$/.test(name)),
      ).toEqual([]);
    });
  });

  describe('the ordering constraint', () => {
    it('13. A re-run with the raw rows ALL gone leaves the rollup intact', async () => {
      // The safe half of the ordering constraint, and it is safe by accident
      // rather than by design — worth pinning either way. `activeTenants` finds
      // nothing, so the job returns before deleting anything and the
      // previously-computed figures survive.
      await generation();
      await generation();

      await runOver('2026-03-01', '2026-03-04');
      // What retention does.
      await fx.prisma.aiGeneration.deleteMany({});
      await runOver('2026-03-01', '2026-03-04');

      const rows = await statsFor('2026-03-02');
      expect(rows).toHaveLength(1);
      expect(rows[0].generations).toBe(2);
    });

    it('14. **A PARTIAL deletion silently UNDER-REPORTS — the real hazard**', async () => {
      // The reason the ordering constraint exists, made mechanical.
      //
      // The tenant still has *some* rows in the window, so the job runs, wipes
      // the day and recomputes it from what retention left behind. The result
      // is a smaller number with no error anywhere — which is exactly the
      // failure described for the chunk projection, arriving here
      // with worse consequences because these figures appear on an invoice
      // discussion.
      const survivor = await generation();
      await generation();
      await generation();

      await runOver('2026-03-01', '2026-03-04');
      const [before] = await statsFor('2026-03-02');
      expect(before.generations).toBe(3);

      // Retention takes two of the three.
      await fx.prisma.aiGeneration.deleteMany({
        where: { id: { not: survivor.id } },
      });
      await runOver('2026-03-01', '2026-03-04');

      const [after] = await statsFor('2026-03-02');
      expect(after.generations).toBe(1);
      // Stated as an assertion rather than a comment: the number went DOWN for
      // a window that cannot change. Anything that reverses the job order will
      // fail here.
      expect(after.generations).toBeLessThan(before.generations);
    });

    it('15. Runs independently of the chunk-usage projection', async () => {
      // Both read `ai_generations` over the same window and neither consumes
      // it, so their relative order does not matter — only their order against
      // RETENTION does. Pinned so nobody adds a dependency between them while
      // trying to fix the constraint above.
      const projection = fx.moduleRef.get(ChunkUsageProjection);

      await generation();
      await projection.project(
        at('2026-03-01T00:00:00.000Z'),
        at('2026-03-04T00:00:00.000Z'),
      );
      await runOver('2026-03-01', '2026-03-04');

      const [row] = await statsFor('2026-03-02');
      expect(row.generations).toBe(1);
    });
  });
});

import { faker } from '@faker-js/faker';
import { RpcException } from '@nestjs/microservices';
import {
  AiGenerationOutcome,
  AiGenerationPurpose,
  DISMISSAL_SUPPRESSION_DAYS,
  DocumentFlagResolution,
  DocumentFlagType,
  DOCUMENT_PATTERNS,
  DocumentStatus,
  IngestionJobStatus,
  INGESTION_QUEUE,
  EMBEDDING_MODEL,
  SCOPE_FANOUT_QUEUE,
  GENERATION_MODEL_BY_TIER,
  QDRANT_PAYLOAD_FIELDS,
  PROJECTION_LAG_MS,
  compareAlphabetically,
} from '@synapsedesk/common';
import { bootstrapE2eTest, CYCLE_START, E2eFixture } from '../utils';
import { memberContext } from '../utils/context';
import { buildTenant, createDocument, TenantFixture } from '../factories';
import { ChunkUsageProjection } from '../../src/modules/scheduled/chunk-usage.projection';
import { DiscardedDraftSweep } from '../../src/modules/scheduled/discarded-draft.sweep';
import {
  QuotaReconciliationJob,
  RECENT_SPEND_WINDOW_MS,
} from '../../src/modules/scheduled/quota-reconciliation.job';
import { DocumentFlagWriter } from '../../src/modules/scheduled/document-flag-writer';
import { DocumentFlagsService } from '../../src/modules/document-flags/document-flags.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ScopeWriterService } from '../../src/modules/ingestion/scope-writer.service';
import { ScopeFanoutQueueService } from '../../src/modules/ingestion/scope-fanout-queue.service';
import { ScopeReconcileSweep } from '../../src/modules/ingestion/scope-reconcile.sweep';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import {
  IngestionReconcileSweep,
  MAX_ORGANIZATIONS_PER_RUN,
  MAX_RECONCILED_PER_RUN,
} from '../../src/modules/ingestion/ingestion-reconcile.sweep';
import { IngestionQueueService } from '../../src/modules/ingestion/ingestion-queue.service';
import { QuotaCounterService } from '../../src/modules/ai-ledger/quota-counter.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('The fan-out and the scheduled jobs (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw.
  const faults = faultInjector();

  let fx: E2eFixture;
  let projection: ChunkUsageProjection;
  let sweep: DiscardedDraftSweep;
  let reconciliation: QuotaReconciliationJob;
  let flags: DocumentFlagWriter;
  let documentFlags: DocumentFlagsService;
  let scopeWriter: ScopeWriterService;
  let fanoutQueue: ScopeFanoutQueueService;
  let qdrant: QdrantService;
  let counter: QuotaCounterService;

  let tenant: TenantFixture;

  const HOUR = 3_600_000;

  /** A document with `count` chunks, all fresh and never retrieved. */
  const documentWithChunks = async (count: number, overrides = {}) => {
    const document = await createDocument(fx.prisma, tenant, {
      status: DocumentStatus.INDEXED,
      ...overrides,
    });

    await fx.prisma.documentChunk.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        documentId: document.id,
        chunkIndex: index,
        contentText: `Chunk ${index} of policy text.`,
        tokenCount: 20,
        organizationId: tenant.organizationId,
        isOrganizationWide: document.isOrganizationWide,
        departmentIds: [],
      })),
    });

    return document;
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    projection = fx.moduleRef.get(ChunkUsageProjection);
    sweep = fx.moduleRef.get(DiscardedDraftSweep);
    reconciliation = fx.moduleRef.get(QuotaReconciliationJob);
    flags = fx.moduleRef.get(DocumentFlagWriter);
    documentFlags = fx.moduleRef.get(DocumentFlagsService);
    scopeWriter = fx.moduleRef.get(ScopeWriterService);
    fanoutQueue = fx.moduleRef.get(ScopeFanoutQueueService);
    qdrant = fx.moduleRef.get(QdrantService);
    counter = fx.moduleRef.get(QuotaCounterService);
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(async () => {
    await fx.close();
  });

  describe('The scope fan-out', () => {
    it('1. Re-scopes EVERY chunk row, not just the first page', async () => {
      // A document with more chunks than one page is the ordinary case, and a
      // loop that stopped early would leave the tail at the OLD scope —
      // retrievable by exactly the people who just lost access.
      const document = await documentWithChunks(120);

      await scopeWriter.apply(
        document.id,
        tenant.organizationId,
        {
          isOrganizationWide: false,
          departmentIds: [tenant.departmentId],
          isDeleted: false,
        },
        { isOrganizationWide: true, departmentIds: [], isDeleted: false },
      );

      const stale = await fx.prisma.documentChunk.count({
        where: { documentId: document.id, isOrganizationWide: true },
      });
      expect(stale).toBe(0);
    });

    it('2. Writes the SCOPE onto the Qdrant points as well', async () => {
      const document = await documentWithChunks(2);
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      await qdrant.upsertChunks(
        chunks.map((chunk, index) => ({
          vectorPointId: `00000000-0000-4000-8000-00000000000${index}`,
          vector: Array.from({ length: 768 }, () => 0.1),
          chunkId: chunk.id,
          documentId: document.id,
          organizationId: tenant.organizationId,
          departmentIds: [],
          isOrganizationWide: true,
          isDeleted: false,
        })),
      );

      await scopeWriter.apply(
        document.id,
        tenant.organizationId,
        {
          isOrganizationWide: false,
          departmentIds: [tenant.departmentId],
          isDeleted: false,
        },
        { isOrganizationWide: true, departmentIds: [], isDeleted: false },
      );

      const points = await qdrant.retrieve([
        '00000000-0000-4000-8000-000000000000',
        '00000000-0000-4000-8000-000000000001',
      ]);

      expect(points).toHaveLength(2);
      for (const point of points) {
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.isOrganizationWide]).toBe(
          false,
        );
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.departmentIds]).toEqual([
          tenant.departmentId,
        ]);
        // Preserved, not overwritten. A full payload replace would drop
        // `chunk_id` and nothing would notice until a citation failed to
        // resolve weeks later.
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.chunkId]).toBeDefined();
      }

      await qdrant.deleteDocumentPoints(document.id, tenant.organizationId);
    });

    it('**2b. a re-scope carrying the WRONG tenant touches nothing**', async () => {
      // The reason all three document-scoped Qdrant operations carry the
      // tenant. A wrong `documentId` on a delete costs the other tenant their
      // vectors, which a reindex restores. The same mistake here flips
      // `is_deleted` and overwrites `department_ids` — a deleted or
      // department-scoped document becomes retrievable to people the boundary
      // excluded, with no failing query anywhere.
      const document = await documentWithChunks(1);
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      const pointId = '00000000-0000-4000-8000-0000000000ff';

      await qdrant.upsertChunks([
        {
          vectorPointId: pointId,
          vector: Array.from({ length: 768 }, () => 0.1),
          chunkId: chunks[0].id,
          documentId: document.id,
          organizationId: tenant.organizationId,
          departmentIds: [],
          isOrganizationWide: false,
          isDeleted: true,
        },
      ]);

      await qdrant.setDocumentScope(document.id, faker.string.uuid(), {
        isOrganizationWide: true,
        departmentIds: [faker.string.uuid()],
        isDeleted: false,
      });

      const [point] = await qdrant.retrieve([pointId]);
      expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.isDeleted]).toBe(true);
      expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.isOrganizationWide]).toBe(
        false,
      );
      expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.departmentIds]).toEqual([]);

      await qdrant.deleteDocumentPoints(document.id, tenant.organizationId);
    });

    it('3. REFUSES the restriction outright when Qdrant is unreachable', async () => {
      // The ordering rule, proven rather than asserted — and this is the test
      // that fails if someone "simplifies" the order.
      //
      // Qdrant goes FIRST on a restriction, so a failure there means NOTHING
      // has been narrowed. Reporting success would tell an admin they had
      // restricted a document that is still fully visible, which is the one
      // outcome worse than an error.
      const document = await documentWithChunks(3);

      faults.failOnce(qdrant, 'setDocumentScope', new Error('qdrant is down'));

      await expect(
        scopeWriter.apply(
          document.id,
          tenant.organizationId,
          {
            isOrganizationWide: false,
            departmentIds: [tenant.departmentId],
            isDeleted: false,
          },
          { isOrganizationWide: true, departmentIds: [], isDeleted: false },
        ),
      ).rejects.toBeInstanceOf(RpcException);

      // Postgres was NOT written, because Qdrant is first. Both stores still
      // hold the OLD scope, consistently — and the caller was told so.
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      expect(chunks.every((chunk) => chunk.isOrganizationWide)).toBe(true);
    });

    it('4. DEFERS rather than fails when Qdrant is unreachable during a GRANT', async () => {
      // The asymmetry. A grant that half-lands under-grants: the document is
      // listed but not yet retrievable, so somebody waits — and the
      // reconciler finishes it. Failing the request instead would refuse a
      // widening that had already partly succeeded.
      const document = await documentWithChunks(2, {
        isOrganizationWide: false,
      });

      faults.failOnce(qdrant, 'setDocumentScope', new Error('qdrant is down'));

      await expect(
        scopeWriter.apply(
          document.id,
          tenant.organizationId,
          { isOrganizationWide: true, departmentIds: [], isDeleted: false },
          { isOrganizationWide: false, departmentIds: [], isDeleted: false },
        ),
      ).resolves.toEqual({ restricting: false });

      // Postgres widened; Qdrant did not.
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      expect(chunks.every((chunk) => chunk.isOrganizationWide)).toBe(true);
    });

    it('5. Detects DRIFT between a document and its chunk rows', async () => {
      // Denormalisation's own failure mode: the fan-out missed a row and
      // retrieval is now serving a stale boundary. Nothing errors — only a
      // comparison finds it.
      const document = await documentWithChunks(3, {
        isOrganizationWide: false,
      });

      // The drift is INTRODUCED explicitly rather than assumed: the fixture
      // copies the document's scope onto its chunks, which is the correct
      // state. What this test needs is the state a MISSED fan-out leaves
      // behind — chunk rows still claiming the old, wider scope.
      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { isOrganizationWide: true },
      });

      await expect(
        scopeWriter.findScopeDrift(document.id),
      ).resolves.toHaveLength(3);

      await scopeWriter.apply(
        document.id,
        tenant.organizationId,
        { isOrganizationWide: false, departmentIds: [], isDeleted: false },
        { isOrganizationWide: true, departmentIds: [], isDeleted: false },
      );

      await expect(scopeWriter.findScopeDrift(document.id)).resolves.toEqual(
        [],
      );
    });
  });

  describe('The scope reconciliation sweep', () => {
    let sweep: ScopeReconcileSweep;

    beforeEach(() => {
      sweep = fx.moduleRef.get(ScopeReconcileSweep);
    });

    it('**1. repairs chunks WIDER than truth, and counts them separately**', async () => {
      // The exposure case. A restriction whose chunk write failed leaves the
      // lexical arm answering with the old, wider scope — someone retrieves a
      // document they were removed from, and nothing reports it.
      const document = await documentWithChunks(3, {
        isOrganizationWide: false,
      });
      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { isOrganizationWide: true },
      });

      const result = await sweep.sweep();

      expect(result.repairedWider).toBe(1);
      // **Separately, not summed.** Averaging an access-control failure into a
      // maintenance number is how it gets read as one.
      expect(result.repairedNarrower).toBe(0);
      await expect(scopeWriter.findScopeDrift(document.id)).resolves.toEqual(
        [],
      );
    });

    it('**2. and a NARROWER document repairs into the other counter**', async () => {
      // The availability case: findable nowhere rather than findable by too
      // many. Both want repairing; only the first wants alerting.
      const document = await documentWithChunks(2, {
        isOrganizationWide: true,
      });
      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { isOrganizationWide: false },
      });

      const result = await sweep.sweep();

      expect(result.repairedNarrower).toBe(1);
      expect(result.repairedWider).toBe(0);
    });

    it('**3. department ids in a DIFFERENT ORDER are not drift**', async () => {
      // The false-positive generator. Postgres array equality is
      // order-sensitive, `department_ids` is written from a JavaScript array,
      // and `array_agg` has no defined order — so `=` in the candidate query
      // nominates most multi-department documents on every run.
      //
      // Nothing would be repaired: `findScopeDrift` compares sets. What it
      // costs is the candidate budget, with real drift queued behind documents
      // that were always fine.
      const other = faker.string.uuid();
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
        isOrganizationWide: false,
      });
      await fx.prisma.departmentDocument.createMany({
        data: [
          { documentId: document.id, departmentId: tenant.departmentId },
          { documentId: document.id, departmentId: other },
        ],
      });
      await fx.prisma.documentChunk.create({
        data: {
          documentId: document.id,
          chunkIndex: 0,
          contentText: 'text',
          tokenCount: 20,
          organizationId: tenant.organizationId,
          isOrganizationWide: false,
          // Same SET, reversed order.
          departmentIds: [other, tenant.departmentId],
        },
      });

      // **Asserted on the CANDIDATE set, not on the repair count.** Nothing is
      // repaired either way — `findScopeDrift` compares sets and rejects a
      // reversed-order match — so a test that only checked `repaired === 0`
      // passes with `=` in the SQL and guards nothing. Sabotage proved exactly
      // that: swapping the containment operators for `<>` left all 49 green.
      //
      // What `=` actually costs is the candidate budget, so the observable is
      // whether this document was NOMINATED at all.
      const verdict = jest.spyOn(scopeWriter, 'findScopeDrift');
      const result = await sweep.sweep();

      const considered = verdict.mock.calls.map(([id]) => id);
      expect(considered).not.toContain(document.id);
      expect(result.repairedWider + result.repairedNarrower).toBe(0);
      verdict.mockRestore();

      await expect(scopeWriter.findScopeDrift(document.id)).resolves.toEqual(
        [],
      );
    });

    it('**4. but a REMOVED department link is caught**', async () => {
      // Test 3 alone passes for a sweep that detects nothing at all, which is
      // also the sweep that reports no false positives. This is what proves 3
      // is a decision.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
        isOrganizationWide: false,
      });
      await fx.prisma.documentChunk.create({
        data: {
          documentId: document.id,
          chunkIndex: 0,
          contentText: 'text',
          tokenCount: 20,
          organizationId: tenant.organizationId,
          isOrganizationWide: false,
          // Claims a department the document is not linked to.
          departmentIds: [tenant.departmentId],
        },
      });

      const result = await sweep.sweep();

      expect(result.repairedWider).toBe(1);
      await expect(scopeWriter.findScopeDrift(document.id)).resolves.toEqual(
        [],
      );
    });

    it('**5. passes the CURRENT scope as `before`, not the truth twice**', async () => {
      // The mistake this sweep can actually make, and it is invisible at the
      // call site: `apply(…, truth, truth)` type-checks, runs, and makes
      // `isRestriction` false — routing a NARROWING repair down the grant path,
      // chunks first with Qdrant non-fatal, which is the one ordering §1 says
      // must never happen.
      //
      // Asserted on the ARGUMENT rather than on the write ordering, which
      // `scope-writer`'s own suite already owns. Duplicating that would cover
      // the same code twice and leave this uncovered.
      const document = await documentWithChunks(2, {
        isOrganizationWide: false,
      });
      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { isOrganizationWide: true },
      });

      const apply = jest.spyOn(scopeWriter, 'apply');
      await sweep.sweep();

      const [, , after, before] = apply.mock.calls[0];
      expect(after.isOrganizationWide).toBe(false);
      // The drifted value, which is what makes this a restriction.
      expect(before.isOrganizationWide).toBe(true);
      apply.mockRestore();
    });

    it('**6. reports an organization_id mismatch and does NOT repair it**', async () => {
      // Not drift: nothing updates this column after ingestion, so a mismatch
      // means something wrote the wrong tenant into the field the lexical arm
      // filters on. Repairing would move rows between tenants and erase the
      // evidence.
      const document = await documentWithChunks(2);
      const foreign = faker.string.uuid();
      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { organizationId: foreign },
      });

      const result = await sweep.sweep();

      expect(result.tenantMismatches).toBe(2);
      const after = await fx.prisma.documentChunk.findFirst({
        where: { documentId: document.id },
      });
      expect(after?.organizationId).toBe(foreign);
    });

    it('7. records a run even when it finds nothing', async () => {
      // `/platform/jobs` exists to tell a healthy sweep from one that is not
      // running, and a heartbeat written only on work makes those identical.
      const result = await sweep.sweep();

      expect(result).toEqual({
        repairedWider: 0,
        repairedNarrower: 0,
        deferred: 0,
        failed: 0,
        tenantMismatches: 0,
      });
    });
  });

  describe('The reconciler queue', () => {
    it('6. Actually QUEUES a job — the enqueue failure is swallowed by design', async () => {
      // This test exists because the swallow hid a real bug: BullMQ rejects a
      // custom job id containing `:`, the id was built from an ISO timestamp,
      // and so every reconciliation silently failed to queue while the
      // endpoint reported success. Non-throwing is correct — the writes are
      // already committed and failing the request would roll nothing back —
      // which is exactly why the queueing has to be asserted rather than
      // assumed.
      const document = await documentWithChunks(1);
      const queue = fx.moduleRef.get<Queue>(getQueueToken(SCOPE_FANOUT_QUEUE));
      await queue.drain(true);

      await fanoutQueue.enqueue({
        pattern: DOCUMENT_PATTERNS.scopeChanged,
        organizationId: tenant.organizationId,
        documentId: document.id,
        occurredAt: new Date().toISOString(),
        isOrganizationWide: false,
        departmentIds: [tenant.departmentId],
        isDeleted: false,
        restricting: true,
      });

      const queued = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(queued.some((job) => job.data.documentId === document.id)).toBe(
        true,
      );

      await queue.drain(true);
    });

    it('7. Queues TWO jobs for two changes to the same document', async () => {
      // Collapsing on document id would drop the second change, leaving the
      // retrievable stores holding the first change's scope while `documents`
      // holds the second's — a drift nothing would report.
      const document = await documentWithChunks(1);
      const queue = fx.moduleRef.get<Queue>(getQueueToken(SCOPE_FANOUT_QUEUE));
      await queue.drain(true);

      const base = {
        pattern: DOCUMENT_PATTERNS.scopeChanged,
        organizationId: tenant.organizationId,
        documentId: document.id,
        isOrganizationWide: false,
        departmentIds: [tenant.departmentId],
        isDeleted: false,
        restricting: true,
      };

      await fanoutQueue.enqueue({
        ...base,
        occurredAt: new Date(Date.now() - 1_000).toISOString(),
      });
      await fanoutQueue.enqueue({
        ...base,
        occurredAt: new Date().toISOString(),
      });

      const queued = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(
        queued.filter((job) => job.data.documentId === document.id),
      ).toHaveLength(2);

      await queue.drain(true);
    });
  });

  describe('The chunk-usage projection', () => {
    const ledgerRow = async (
      retrieved: string[],
      cited: string[],
      createdAt = new Date(),
    ) => {
      return fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.CHAT_ANSWER,
          modelName: GENERATION_MODEL_BY_TIER.FAST,
          promptTokens: 100,
          completionTokens: 50,
          estimatedCostMicros: 30n,
          retrievedChunkIds: retrieved,
          citedChunkIds: cited,
          createdAt,
        },
      });
    };

    /**
     * The nightly path needs a cursor; `project()` refuses without one.
     *
     * Seeded directly rather than through `backfill()` so each test states the
     * interval it is about. `backfill()` has its own tests below.
     */
    const seedCursor = (until: Date) =>
      fx.prisma.projectionCursor.create({
        data: { name: 'chunk-usage-projection', until },
      });

    it('6. Projects retrieval and citation counts onto the chunk rows', async () => {
      const document = await documentWithChunks(2);
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      await seedCursor(new Date(Date.now() - HOUR));
      await ledgerRow([chunks[0].id, chunks[1].id], [chunks[0].id]);

      await projection.project(new Date(Date.now() + HOUR));

      const [first, second] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      expect(first.retrievalCount).toBe(1);
      expect(first.citationCount).toBe(1);
      expect(first.lastRetrievedAt).not.toBeNull();

      // Retrieved but not cited — the state `UNCITED` is built on.
      expect(second.retrievalCount).toBe(1);
      expect(second.citationCount).toBe(0);
    });

    it('7. **A generation is counted by exactly ONE run** — the cursor, not a window', async () => {
      // The cursor makes consecutive intervals abut by construction; the
      // boundary row belongs to exactly one run. Asserted below.
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      const boundary = new Date('2026-08-10T00:00:00.000Z');
      await seedCursor(new Date('2026-08-09T00:00:00.000Z'));
      await ledgerRow([chunk.id], [], boundary);

      // Half-open at the top: `created_at === until` belongs to the NEXT run.
      await projection.project(boundary);
      expect(
        (
          await fx.prisma.documentChunk.findUniqueOrThrow({
            where: { id: chunk.id },
          })
        ).retrievalCount,
      ).toBe(0);

      // The next run's lower bound is that same instant, so the row is picked
      // up exactly once — the property the overlapping window could not give.
      await projection.project(new Date('2026-08-11T00:00:00.000Z'));
      expect(
        (
          await fx.prisma.documentChunk.findUniqueOrThrow({
            where: { id: chunk.id },
          })
        ).retrievalCount,
      ).toBe(1);

      // A third run over a later interval must not find it again.
      await projection.project(new Date('2026-08-12T00:00:00.000Z'));
      expect(
        (
          await fx.prisma.documentChunk.findUniqueOrThrow({
            where: { id: chunk.id },
          })
        ).retrievalCount,
      ).toBe(1);
    });

    it('**7a. Running twice over the same generations changes nothing**', async () => {
      // The row's headline, at its simplest: the second call is a no-op.
      const document = await documentWithChunks(2);
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      await seedCursor(new Date(Date.now() - HOUR));
      await ledgerRow([chunks[0].id, chunks[1].id], [chunks[0].id]);
      await ledgerRow([chunks[0].id], [chunks[0].id]);

      const until = new Date(Date.now() + HOUR);
      await projection.project(until);

      const afterFirst = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      await projection.project(new Date(Date.now() + 2 * HOUR));

      const afterSecond = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      expect(afterFirst.map((c) => c.retrievalCount)).toEqual([2, 1]);
      expect(afterSecond.map((c) => c.retrievalCount)).toEqual([2, 1]);
      expect(afterSecond.map((c) => c.citationCount)).toEqual([2, 0]);
    });

    it('**7b. A generation after the cursor is counted once; one before it never again**', async () => {
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      await seedCursor(new Date(Date.now() - 3 * HOUR));
      await ledgerRow([chunk.id], [chunk.id], new Date(Date.now() - 2 * HOUR));
      const first = new Date(Date.now() - HOUR);
      await projection.project(first);

      // A second generation lands after the cursor.
      await ledgerRow([chunk.id], [], new Date(Date.now() - HOUR / 2));
      await projection.project(new Date(Date.now()));

      const projected = await fx.prisma.documentChunk.findUniqueOrThrow({
        where: { id: chunk.id },
      });

      // Two retrievals total — one per generation, each counted by one run.
      // The citation came only from the first, and the second run did not add
      // it again.
      expect(projected.retrievalCount).toBe(2);
      expect(projected.citationCount).toBe(1);

      const cursor = await fx.prisma.projectionCursor.findUniqueOrThrow({
        where: { name: 'chunk-usage-projection' },
      });
      expect(cursor.until.getTime()).toBeGreaterThan(first.getTime());
    });

    it('**7c. The nightly run REFUSES without a cursor rather than inventing one**', async () => {
      // A run with no lower bound would have to reset the counters and derive
      // from the whole ledger, inside one transaction — a full-table lock on
      // `document_chunks` while uploads wait on it. That work belongs to the
      // backfill, which is somebody's deliberate command; the scheduled step
      // says so instead of improvising.
      await documentWithChunks(1);

      await expect(
        projection.project(new Date(Date.now() + HOUR)),
      ).rejects.toThrow(/projection_cursors/);
    });

    it('**7e. The backfill resets, seeds the cursor, and re-derives**', async () => {
      // A run that finds no cursor cannot trust the counters: nothing records
      // what produced them, so they are not a base. 999 stands in for an
      // untrusted value.
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      await ledgerRow([chunk.id], [chunk.id]);
      await fx.prisma.documentChunk.update({
        where: { id: chunk.id },
        data: { retrievalCount: 999, citationCount: 999 },
      });

      await projection.backfill(new Date(Date.now() + HOUR));

      const projected = await fx.prisma.documentChunk.findUniqueOrThrow({
        where: { id: chunk.id },
      });

      expect(projected.retrievalCount).toBe(1);
      expect(projected.citationCount).toBe(1);
      // The timestamps are NOT reset — a reindex keeps them, and "when was this
      // last retrieved" survives a recount.
      expect(projected.lastRetrievedAt).not.toBeNull();

      // And the cursor it seeded is what lets the nightly run start.
      const cursor = await fx.prisma.projectionCursor.findUniqueOrThrow({
        where: { name: 'chunk-usage-projection' },
      });
      expect(cursor.until.getTime()).toBeGreaterThan(Date.now());
    });

    it('**7f. A second backfill adds nothing** — it resumes, it does not reset', async () => {
      // The property that makes an interrupted backfill safe to re-run: the
      // cursor is committed per window, so a second call finds it, skips the
      // reset, and projects an empty interval.
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      await ledgerRow([chunk.id], [chunk.id]);

      await projection.backfill(new Date(Date.now() + HOUR));
      await projection.backfill(new Date(Date.now() + 2 * HOUR));

      const projected = await fx.prisma.documentChunk.findUniqueOrThrow({
        where: { id: chunk.id },
      });

      expect(projected.retrievalCount).toBe(1);
      expect(projected.citationCount).toBe(1);
    });

    it('**7d. The LAG is honoured — a fresh generation waits for the next run**', async () => {
      // The one subtlety a cursor has that an overlapping window did not. A
      // generation committed just under the upper bound can be invisible to the
      // statement that reads it, and a cursor moved past that instant would
      // never look again. Lagging the bound is what buys the writer time.
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      await seedCursor(new Date(Date.now() - HOUR));
      await ledgerRow([chunk.id], [], new Date());

      // `until` behind the generation, exactly as `daily()` computes it.
      await projection.project(new Date(Date.now() - PROJECTION_LAG_MS));
      expect(
        (
          await fx.prisma.documentChunk.findUniqueOrThrow({
            where: { id: chunk.id },
          })
        ).retrievalCount,
      ).toBe(0);

      // The next run's bound has moved past it — counted, and counted once.
      await projection.project(new Date(Date.now() + HOUR));
      expect(
        (
          await fx.prisma.documentChunk.findUniqueOrThrow({
            where: { id: chunk.id },
          })
        ).retrievalCount,
      ).toBe(1);
    });
  });

  describe('Document flags', () => {
    it('8. Flags a never-retrieved document as UNRETRIEVED', async () => {
      await documentWithChunks(2);

      await flags.detect(tenant.organizationId);

      const raised = await fx.prisma.documentFlag.findMany({
        where: { organizationId: tenant.organizationId },
      });
      expect(raised.map((flag) => flag.flagType)).toEqual([
        DocumentFlagType.UNRETRIEVED,
      ]);
    });

    it('9. Flags a retrieved-but-never-cited document as UNCITED, NOT as UNRETRIEVED', async () => {
      // The distinction made mechanical. `UNCITED` is the interesting one: the
      // retriever keeps selecting it and the generator keeps declining to use
      // it, so it occupies a context slot a useful document would hold.
      const document = await documentWithChunks(1);

      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { retrievalCount: 50, citationCount: 0 },
      });

      await flags.detect(tenant.organizationId);

      const raised = await fx.prisma.documentFlag.findMany({
        where: { organizationId: tenant.organizationId },
      });
      expect(raised.map((flag) => flag.flagType)).toEqual([
        DocumentFlagType.UNCITED,
      ]);
    });

    it('10. Leaves a document alone once it has been cited even once', async () => {
      const document = await documentWithChunks(1);

      await fx.prisma.documentChunk.updateMany({
        where: { documentId: document.id },
        data: { retrievalCount: 50, citationCount: 1 },
      });

      await flags.detect(tenant.organizationId);

      await expect(
        fx.prisma.documentFlag.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).resolves.toBe(0);
    });

    it('11. Does NOT re-raise a flag a human resolved', async () => {
      // Otherwise the job argues with a person once a day until they stop
      // reading flags entirely.
      const document = await documentWithChunks(1);
      await flags.detect(tenant.organizationId);

      const [flag] = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      // Through the tenant-facing service, which is where `resolve` now lives:
      // the sweep raises, a person resolves, and the two are different halves.
      await documentFlags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
        'not a problem',
      );

      await flags.detect(tenant.organizationId);

      const raised = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      expect(raised).toHaveLength(1);
      expect(raised[0].resolvedById).toBe(tenant.userId);
    });

    it('**11a. DOES re-raise one marked FIXED — the fix may not have worked**', async () => {
      // The case that was wrong: FIXED asserted the problem was gone, and the
      // detector finding it again is the one message that must not be
      // swallowed. Under the old rule this document could never be flagged
      // again for this type.
      const document = await documentWithChunks(1);
      await flags.detect(tenant.organizationId);

      const [raised] = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      await documentFlags.resolve(
        raised.id,
        DocumentFlagResolution.FIXED,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
      );

      await flags.detect(tenant.organizationId);

      const after = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
        orderBy: { detectedAt: 'asc' },
      });
      // A SECOND row. The first stays as the record that someone tried.
      expect(after).toHaveLength(2);
      expect(after[0].resolution).toBe(DocumentFlagResolution.FIXED);
      expect(after[1].resolvedAt).toBeNull();
    });

    it('**11a2. re-raises a DISMISSED one once the window has passed**', async () => {
      // A window, not a life sentence: permanent suppression makes one wrong
      // click unappealable and invisible.
      const document = await documentWithChunks(1);
      await flags.detect(tenant.organizationId);

      const [raised] = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      await documentFlags.resolve(
        raised.id,
        DocumentFlagResolution.DISMISSED,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
        'seasonal',
      );
      // Backdated past the window rather than waiting thirty days for it.
      await fx.prisma.documentFlag.update({
        where: { id: raised.id },
        data: {
          resolvedAt: new Date(
            Date.now() - (DISMISSAL_SUPPRESSION_DAYS + 1) * 24 * 60 * 60 * 1000,
          ),
        },
      });

      await flags.detect(tenant.organizationId);

      const after = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      expect(after).toHaveLength(2);
      // And the dismissal's reason survives on the old row, so whoever sees the
      // flag return can read why it was dismissed last time.
      const dismissed = after.find((flag) => flag.id === raised.id);
      expect(dismissed?.resolutionComment).toBe('seasonal');
    });

    it('**11b. DOES re-raise one that was deleted rather than resolved**', async () => {
      // Documented behaviour, asserted so nobody "fixes" it. Delete removes the
      // row AND the exclusion `raise()` reads, so for a swept type the finding
      // returns next cycle. Dismiss is what makes a finding go away; delete is
      // for a row that should not exist.
      const document = await documentWithChunks(1);
      await flags.detect(tenant.organizationId);

      const [raised] = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      await documentFlags.deleteDocumentFlag(
        raised.id,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
      );

      await flags.detect(tenant.organizationId);

      const after = await fx.prisma.documentFlag.findMany({
        where: { documentId: document.id },
      });
      expect(after).toHaveLength(1);
      // A NEW row, not the one that was deleted.
      expect(after[0].id).not.toBe(raised.id);
      expect(after[0].resolvedAt).toBeNull();
    });

    it('12. Never flags a document that is still PROCESSING', async () => {
      // A pipeline state is not a quality problem, and reporting it as one
      // sends someone to fix a document that is merely not finished.
      await documentWithChunks(1, { status: DocumentStatus.PROCESSING });

      await flags.detect(tenant.organizationId);

      await expect(
        fx.prisma.documentFlag.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).resolves.toBe(0);
    });
  });

  describe('The DISCARDED sweep', () => {
    const draft = async (createdAt: Date, overrides = {}) => {
      return fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.DRAFT,
          modelName: GENERATION_MODEL_BY_TIER.FAST,
          promptTokens: 500,
          completionTokens: 100,
          estimatedCostMicros: 90n,
          content: 'A drafted reply.',
          createdAt,
          ...overrides,
        },
      });
    };

    it('13. Sweeps a draft nobody referenced within 24 hours', async () => {
      await draft(new Date(Date.now() - 25 * HOUR));

      await expect(sweep.sweep()).resolves.toBe(1);

      const [row] = await fx.prisma.aiGeneration.findMany();
      expect(row.outcome).toBe(AiGenerationOutcome.DISCARDED);
    });

    it('14. LEAVES a draft posted at hour 23 alone', async () => {
      // The race the interval exists to avoid: an agent opens a draft, gets
      // pulled away, and posts it hours later.
      await draft(new Date(Date.now() - 23 * HOUR), {
        outcome: AiGenerationOutcome.ACCEPTED,
        resultingMessageId: '33333333-3333-4333-8333-333333333333',
      });

      await expect(sweep.sweep()).resolves.toBe(0);

      const [row] = await fx.prisma.aiGeneration.findMany();
      expect(row.outcome).toBe(AiGenerationOutcome.ACCEPTED);
    });

    it('15. Reports acceptance as 25% over 1 accepted and 3 ignored', async () => {
      // The whole point. Divide by only the drafts that were USED and the
      // answer is near 100% no matter how bad the drafts are.
      await draft(new Date(Date.now() - 30 * HOUR), {
        outcome: AiGenerationOutcome.ACCEPTED,
        resultingMessageId: '44444444-4444-4444-8444-444444444444',
      });
      await draft(new Date(Date.now() - 30 * HOUR));
      await draft(new Date(Date.now() - 30 * HOUR));
      await draft(new Date(Date.now() - 30 * HOUR));

      await sweep.sweep();

      const rate = await sweep.acceptanceRate(
        tenant.organizationId,
        new Date(Date.now() - 90 * HOUR),
      );

      expect(rate.accepted).toBe(1);
      expect(rate.discarded).toBe(3);
      expect(rate.rate).toBeCloseTo(0.25);
    });

    it('16. Reports 0 rather than NaN over an empty window', async () => {
      const rate = await sweep.acceptanceRate(
        tenant.organizationId,
        new Date(Date.now() - HOUR),
      );

      expect(rate.rate).toBe(0);
    });
  });

  describe('Quota reconciliation', () => {
    it('17. CONVERGES a counter that drifted from the ledger', async () => {
      // The actual invariant. An earlier draft asserted counter and SUM()
      // always agree, which directly contradicts `record()` swallowing
      // failures: they WILL diverge, and what must hold is that
      // reconciliation converges them.
      await fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.EMBEDDING,
          modelName: EMBEDDING_MODEL,
          promptTokens: 1_000,
          completionTokens: 0,
          estimatedCostMicros: 25n,
          createdAt: new Date(CYCLE_START.getTime() + HOUR),
        },
      });

      // The counter says something else entirely — a swallowed write.
      await counter.charge(tenant.organizationId, CYCLE_START, 999n);

      await reconciliation.reconcile(tenant.organizationId, CYCLE_START);

      await expect(
        counter.spentMicros(tenant.organizationId, CYCLE_START),
      ).resolves.toBe(25n);
    });

    it('18. Moves the COUNTER, never the ledger', async () => {
      // `SUM(estimated_cost_micros)` is the definition of spend; the counter
      // is a cache of it. Correcting in the other direction would make a
      // caching bug rewrite the books.
      const row = await fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.EMBEDDING,
          modelName: EMBEDDING_MODEL,
          promptTokens: 1_000,
          completionTokens: 0,
          estimatedCostMicros: 25n,
          createdAt: new Date(CYCLE_START.getTime() + HOUR),
        },
      });

      await counter.charge(tenant.organizationId, CYCLE_START, 999n);
      await reconciliation.reconcile(tenant.organizationId, CYCLE_START);

      const after = await fx.prisma.aiGeneration.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.estimatedCostMicros).toBe(25n);
    });

    it('19. Ignores spend from BEFORE the cycle started', async () => {
      // The cycle is in the Redis key, so a billing reset invalidates the
      // counter for free — and summing across the reset would undo that.
      await fx.prisma.aiGeneration.create({
        data: {
          organizationId: tenant.organizationId,
          purpose: AiGenerationPurpose.EMBEDDING,
          modelName: EMBEDDING_MODEL,
          promptTokens: 1_000,
          completionTokens: 0,
          estimatedCostMicros: 500n,
          createdAt: new Date(CYCLE_START.getTime() - HOUR),
        },
      });

      await expect(
        reconciliation.reconcile(tenant.organizationId, CYCLE_START),
      ).resolves.toBe(0n);
    });

    /**
     * The bug found while tracing the call sites.
     *
     * `reconcileAll(cycleStart: Date)` took ONE cycle start and applied it to
     * every tenant, directly contradicting the warning on `reconcile()`:
     * *"the cycle start differs per tenant, so a job that assumed one would
     * silently reconcile everyone against whichever tenant's cycle it picked."*
     *
     * The consequence was not a wrong log line. `QuotaCounterService` keys on
     * `quota:{org}:{cycleStartEpoch}`, so reconciling with the wrong cycle
     * wrote the corrected total **under a key the gate never reads**, leaving
     * the real key's drift untouched — a sweep that reported success and fixed
     * nothing.
     *
     * **A single-tenant test passes against the broken version**, which is why
     * these use two tenants with genuinely different cycles.
     */
    describe('every tenant against its OWN cycle', () => {
      // **Anchored to the job's window, never to the suite's fixed
      // `CYCLE_START`.** `reconcileAll()` chooses WHO to reconcile from spend in
      // the last `RECENT_SPEND_WINDOW_MS` of the real clock, so spend dated from
      // a fixed day ages out of it on its own: these tests used 2026-08-01 and
      // stopped selecting their tenants 45 days later with no code change.
      // Derived from the window, so a change to its length cannot reopen that.
      const FIRST_CYCLE = new Date(Date.now() - RECENT_SPEND_WINDOW_MS / 2);
      const OTHER_CYCLE = new Date(Date.now() - RECENT_SPEND_WINDOW_MS / 4);

      const spend = (organizationId: string, micros: bigint, at: Date) =>
        fx.prisma.aiGeneration.create({
          data: {
            organizationId,
            purpose: AiGenerationPurpose.EMBEDDING,
            modelName: EMBEDDING_MODEL,
            promptTokens: 1_000,
            completionTokens: 0,
            estimatedCostMicros: micros,
            createdAt: at,
          },
        });

      it('20. **both tenants end correct under their OWN cycle key**', async () => {
        const other = buildTenant();

        await spend(
          tenant.organizationId,
          25n,
          new Date(FIRST_CYCLE.getTime() + HOUR),
        );
        await spend(
          other.organizationId,
          70n,
          new Date(OTHER_CYCLE.getTime() + HOUR),
        );

        // Both counters drifted.
        await counter.charge(tenant.organizationId, FIRST_CYCLE, 999n);
        await counter.charge(other.organizationId, OTHER_CYCLE, 888n);

        const cycles = jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(
            new Map([
              [tenant.organizationId, FIRST_CYCLE],
              [other.organizationId, OTHER_CYCLE],
            ]),
          );

        await reconciliation.reconcileAll();

        // Both were SELECTED. Without this, spend that fell out of the job's
        // window reads as a wrong number rather than as nobody being looked at.
        expect(cycles).toHaveBeenCalledWith(
          expect.arrayContaining([tenant.organizationId, other.organizationId]),
        );

        await expect(
          counter.spentMicros(tenant.organizationId, FIRST_CYCLE),
        ).resolves.toBe(25n);
        await expect(
          counter.spentMicros(other.organizationId, OTHER_CYCLE),
        ).resolves.toBe(70n);
      });

      it('21. does NOT write under the other tenant’s cycle key', async () => {
        // The precise failure of the old signature: a correction landing on a
        // key the gate never reads. Asserting the right key holds the right
        // number is not enough — the wrong key must stay empty, or a future
        // regression could satisfy both by writing everywhere.
        const other = buildTenant();

        await spend(
          other.organizationId,
          70n,
          new Date(OTHER_CYCLE.getTime() + HOUR),
        );

        const cycles = jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(new Map([[other.organizationId, OTHER_CYCLE]]));

        await reconciliation.reconcileAll();

        // Selected — or "nothing was written under the wrong key" is true only
        // because nothing was written anywhere.
        expect(cycles).toHaveBeenCalledWith(
          expect.arrayContaining([other.organizationId]),
        );

        // Under the OTHER tenant's cycle — the date the broken version would
        // have used for everybody — nothing was written.
        await expect(
          counter.spentMicros(other.organizationId, FIRST_CYCLE),
        ).resolves.toBe(0n);
      });

      it('22. **SKIPS a tenant whose cycle cannot be resolved**, rather than guessing', async () => {
        // Reconciling against a guessed cycle is worse than not reconciling:
        // the drift stays AND a wrong number is written somewhere nothing
        // reads. Skipping leaves the existing drift for the next hourly run.
        await spend(
          tenant.organizationId,
          25n,
          new Date(FIRST_CYCLE.getTime() + HOUR),
        );
        await counter.charge(tenant.organizationId, FIRST_CYCLE, 999n);

        const cycles = jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(new Map());

        await expect(reconciliation.reconcileAll()).resolves.toBe(0);

        // **The tenant was SELECTED and then skipped** — the behaviour under
        // test. A tenant outside the job's window also yields `0` and untouched
        // drift, without the skip branch ever running.
        expect(cycles).toHaveBeenCalledWith(
          expect.arrayContaining([tenant.organizationId]),
        );

        // Untouched — still drifted, and still correctable next hour.
        await expect(
          counter.spentMicros(tenant.organizationId, FIRST_CYCLE),
        ).resolves.toBe(999n);
      });
    });
  });

  // ------------------------------------------------- the reconciliation sweep

  describe('The ingestion reconciliation sweep', () => {
    let sweep: IngestionReconcileSweep;
    let ingestionQueue: Queue;
    let getAiEntitlement: jest.SpyInstance;

    beforeAll(() => {
      sweep = fx.moduleRef.get(IngestionReconcileSweep);
      ingestionQueue = fx.moduleRef.get<Queue>(getQueueToken(INGESTION_QUEUE));
      // auth-service is not running for this suite. The entitlement is the
      // variable every test here wants to control anyway.
      getAiEntitlement = jest.spyOn(
        fx.moduleRef.get(AuthReferenceService),
        'getAiEntitlement',
      );
    });

    afterAll(() => getAiEntitlement.mockRestore());

    beforeEach(async () => {
      await ingestionQueue.obliterate({ force: true });
      // Under budget unless a test says otherwise.
      getAiEntitlement.mockResolvedValue({
        budgetMicros: 100_000_000n,
        billingCycleStart: CYCLE_START,
      });
    });

    afterEach(async () => {
      await ingestionQueue.obliterate({ force: true });
    });

    /** A stuck job: QUEUED, and nothing in the queue holds it. */
    const stuck = async (
      overrides: Record<string, unknown> = {},
      t = tenant,
    ) => {
      const document = await createDocument(fx.prisma, t);
      return fx.prisma.ingestionJob.create({
        data: {
          organizationId: t.organizationId,
          documentId: document.id,
          bullmqJobId: '',
          status: IngestionJobStatus.QUEUED,
          ...overrides,
        },
      });
    };

    const queuedIds = async () =>
      (await ingestionQueue.getJobs(['waiting', 'delayed', 'active']))
        .map((job) => job.id)
        .filter((id): id is string => id !== undefined);

    it('1. **re-queues a job the event never reached**', async () => {
      // Arm A. The row looks healthy forever: QUEUED, `bullmqJobId: \'\'`, a
      // PENDING document, and nothing scheduled to change either.
      const job = await stuck();

      const result = await sweep.sweep();

      expect(result.enqueued).toBe(1);
      expect(await queuedIds()).toEqual([job.id]);
    });

    it('2. **leaves a job the queue still holds alone**', async () => {
      // The sweep must not fight a job about to run — `isRunnable` is what
      // tells a stranded QUEUED row from one waiting its turn.
      const job = await stuck();
      await ingestionQueue.add(
        'ingest-document',
        { ingestionJobId: job.id },
        { jobId: job.id },
      );

      const result = await sweep.sweep();

      expect(result.skippedRunnable).toBe(1);
      expect(result.enqueued + result.drained).toBe(0);
    });

    it('3. **re-queues nothing for a capped tenant — arm A included**', async () => {
      // The finding that made this one gate rather than two. The budget check
      // lives at the EMBEDDING step, so a re-enqueue that will defer still pays
      // for the download, the parse and the chunking first. Ten stuck documents
      // in a capped tenant is ten full parses every ten minutes, forever — and
      // that is as true of a never-enqueued job as of a deferred one.
      getAiEntitlement.mockResolvedValue({
        budgetMicros: 0n,
        billingCycleStart: CYCLE_START,
      });
      await stuck();
      await stuck({ bullmqJobId: faker.string.uuid() });

      const result = await sweep.sweep();

      // ORGANIZATIONS, not jobs: two stuck documents in one capped tenant is
      // one skip. "100 at cap" and "100 across 40 tenants" are different
      // operational situations and the counter has to be able to say which.
      expect(result.skippedAtCap).toBe(1);
      expect(result.enqueued + result.drained).toBe(0);
      expect(await queuedIds()).toEqual([]);
    });

    it('4. and re-queues both once the budget allows', async () => {
      // Arm B working at all is what closed known-gaps #3: `drainDeferred`
      // existed from the day the pipeline was built and had no caller until
      // this sweep.
      const lost = await stuck();
      const deferred = await stuck({ bullmqJobId: faker.string.uuid() });

      const result = await sweep.sweep();

      expect(result.enqueued).toBe(1);
      expect(result.drained).toBe(1);
      expect((await queuedIds()).sort(compareAlphabetically)).toEqual(
        [lost.id, deferred.id].sort(compareAlphabetically),
      );
    });

    it('5. **many stuck jobs in one tenant cost ONE entitlement read**', async () => {
      // Grouped per organization, not per job. Without it a backlog of forty
      // documents is forty cross-service reads every ten minutes.
      for (let index = 0; index < 6; index += 1) await stuck();
      getAiEntitlement.mockClear();

      await sweep.sweep();

      expect(getAiEntitlement).toHaveBeenCalledTimes(1);
    });

    it('6. **a capped tenant does not block a healthy one**', async () => {
      // Grouping must not become a single decision for everybody: the check is
      // per organization and so is the skip.
      const other = buildTenant();
      await stuck({}, tenant);
      const healthy = await stuck({}, other);

      getAiEntitlement.mockImplementation(
        (context: { organizationId: string }) =>
          Promise.resolve({
            budgetMicros:
              context.organizationId === tenant.organizationId
                ? 0n
                : 100_000_000n,
            billingCycleStart: CYCLE_START,
          }),
      );

      const result = await sweep.sweep();

      expect(result.skippedAtCap).toBe(1);
      expect(result.enqueued).toBe(1);
      expect(await queuedIds()).toEqual([healthy.id]);
    });

    it('7. never touches a job that is mid-flight', async () => {
      // PARSING/CHUNKING/EMBEDDING is a worker already writing chunks for that
      // document. A second worker on it is what `writeChunkRows` cannot survive.
      await stuck({ status: IngestionJobStatus.PARSING });
      await stuck({ status: IngestionJobStatus.EMBEDDING });

      const result = await sweep.sweep();

      expect(result.enqueued + result.drained).toBe(0);
      expect(await queuedIds()).toEqual([]);
    });

    it('8. **takes the OLDEST first**', async () => {
      // The document stuck longest belongs to the person who has been waiting
      // longest, and a backlog over the cap should drain in that order rather
      // than in whatever order the planner returns.
      //
      // Asserted on the ENQUEUE order, not on `getJobs()`: BullMQ makes no
      // promise about the order it returns a set in, so reading the queue back
      // would be testing Redis rather than the sweep. The first version of this
      // test did exactly that and failed for it.
      const older = await stuck();
      await stuck();
      await fx.prisma.ingestionJob.update({
        where: { id: older.id },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      const enqueue = jest.spyOn(
        fx.moduleRef.get(IngestionQueueService),
        'enqueue',
      );

      const result = await sweep.sweep();

      expect(result.enqueued).toBe(2);
      expect(enqueue.mock.calls[0][0].ingestionJobId).toBe(older.id);
      enqueue.mockRestore();
    });

    it('8b. **and is bounded, so one tick cannot become an unbounded sweep**', async () => {
      // The candidate query carries a `take`. Without it a backlog after an
      // outage turns one tick into a scan-and-enqueue over every stuck row in
      // the tenant — the sweep becoming the thing that overwhelms the queue it
      // exists to top up.
      const findMany = jest.spyOn(fx.prisma.ingestionJob, 'findMany');
      await stuck();

      await sweep.sweep();

      expect(findMany.mock.calls[0][0]).toMatchObject({
        take: MAX_RECONCILED_PER_RUN,
        orderBy: { createdAt: 'asc' },
      });
      findMany.mockRestore();
    });

    it('**10. a capped tenant at the head of the queue does not starve the rest**', async () => {
      // The starvation, and it was silent from every surface: the take was
      // applied BEFORE anything knew which tenants were over budget, so a
      // capped tenant holding the oldest rows owned every tick forever while
      // the heartbeat reported healthy.
      //
      // The capped tenant's jobs are made older than the healthy one's, so
      // `createdAt asc` would hand them the whole budget under the old shape.
      const other = buildTenant();
      const capped = [await stuck({}, tenant), await stuck({}, tenant)];
      await fx.prisma.ingestionJob.updateMany({
        where: { id: { in: capped.map((job) => job.id) } },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      const healthy = await stuck({}, other);

      getAiEntitlement.mockImplementation(
        (context: { organizationId: string }) =>
          Promise.resolve({
            budgetMicros:
              context.organizationId === tenant.organizationId
                ? 0n
                : 100_000_000n,
            billingCycleStart: CYCLE_START,
          }),
      );

      const result = await sweep.sweep();

      expect(result.skippedAtCap).toBe(1);
      expect(await queuedIds()).toEqual([healthy.id]);
    });

    it('**11. one unparseable row does not block the queue behind it**', async () => {
      // `parseOcrLanguages` refuses rather than filters, so a row carrying a
      // code this build no longer knows throws inside the loop. Uncaught, it
      // aborted the sweep — and `createdAt asc` meant the same row was hit
      // first again on the next tick, forever.
      //
      // Written directly to the column: `confirmDocument` now refuses this on
      // the way in, which is the other half of the fix. What remains reachable
      // is a legacy row or a future `OCR_LANGUAGES` retirement.
      const poison = await stuck();
      await fx.prisma.document.update({
        where: { id: poison.documentId },
        data: { ocrLanguages: ['kl'] },
      });
      const healthy = await stuck();
      await fx.prisma.ingestionJob.update({
        where: { id: poison.id },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      const result = await sweep.sweep();

      expect(result.unreconcilable).toBe(1);
      expect(result.enqueued).toBe(1);
      expect(await queuedIds()).toEqual([healthy.id]);
    });

    it('**12. a job whose document was DELETED is not re-ingested**', async () => {
      // `deleteDocument` soft-deletes the document and never touches
      // `ingestion_jobs`, so a document deleted while its job was stranded
      // still has a QUEUED row. Re-queueing it parses, chunks and EMBEDS it —
      // metered against the tenant — before `writeChunkRows` marks the chunks
      // deleted. No disclosure, and a full ingestion nobody asked for.
      const job = await stuck();
      await fx.prisma.document.update({
        where: { id: job.documentId },
        data: { deletedAt: new Date() },
      });

      const result = await sweep.sweep();

      expect(result.enqueued).toBe(0);
      expect(await queuedIds()).toEqual([]);
    });

    it('**13. the number of ENTITLEMENT READS is bounded too**', async () => {
      // Fixing the starvation moved the read count from rows to tenants, which
      // is a second unbounded axis: a hundred tenants with one stranded
      // document each would be a hundred cross-service reads per tick.
      const tenants = Array.from(
        { length: MAX_ORGANIZATIONS_PER_RUN + 3 },
        () => buildTenant(),
      );
      for (const t of tenants) await stuck({}, t);
      getAiEntitlement.mockClear();

      await sweep.sweep();

      expect(getAiEntitlement).toHaveBeenCalledTimes(MAX_ORGANIZATIONS_PER_RUN);
    });

    it('9. a sweep with nothing to do enqueues nothing and does not throw', async () => {
      // The ordinary tick. `/platform/jobs` needs the heartbeat either way: a
      // sweep that only records a run when it finds work reports `never-ran` on
      // a healthy system.
      const result = await sweep.sweep();

      expect(result).toEqual({
        enqueued: 0,
        drained: 0,
        skippedAtCap: 0,
        skippedRunnable: 0,
        unreconcilable: 0,
      });
    });
  });
});

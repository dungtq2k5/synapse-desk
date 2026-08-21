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
  EMBEDDING_MODEL,
  SCOPE_FANOUT_QUEUE,
  GENERATION_MODEL_BY_TIER,
  QDRANT_PAYLOAD_FIELDS,
} from '@synapsedesk/common';
import { bootstrapE2eTest, CYCLE_START, E2eFixture } from '../utils';
import { memberContext } from '../utils/context';
import { buildTenant, createDocument, TenantFixture } from '../factories';
import { ChunkUsageProjection } from '../../src/modules/scheduled/chunk-usage.projection';
import { DiscardedDraftSweep } from '../../src/modules/scheduled/discarded-draft.sweep';
import { QuotaReconciliationJob } from '../../src/modules/scheduled/quota-reconciliation.job';
import { DocumentFlagWriter } from '../../src/modules/scheduled/document-flag-writer';
import { DocumentFlagsService } from '../../src/modules/document-flags/document-flags.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ScopeWriterService } from '../../src/modules/ingestion/scope-writer.service';
import { ScopeFanoutQueueService } from '../../src/modules/ingestion/scope-fanout-queue.service';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
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

    it('6. Projects retrieval and citation counts onto the chunk rows', async () => {
      const document = await documentWithChunks(2);
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
        orderBy: { chunkIndex: 'asc' },
      });

      await ledgerRow([chunks[0].id, chunks[1].id], [chunks[0].id]);

      await projection.project(
        new Date(Date.now() - HOUR),
        new Date(Date.now() + HOUR),
      );

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

    it('7. Uses a HALF-OPEN window, so consecutive runs neither skip nor double-count', async () => {
      const document = await documentWithChunks(1);
      const [chunk] = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });

      const boundary = new Date('2026-08-10T00:00:00.000Z');
      await ledgerRow([chunk.id], [], boundary);

      // The row sits exactly on the boundary. A closed interval on both sides
      // counts it in BOTH windows — rare enough to look like noise, frequent
      // enough to matter over months.
      await projection.project(new Date('2026-08-09T00:00:00.000Z'), boundary);
      await projection.project(boundary, new Date('2026-08-11T00:00:00.000Z'));

      const projected = await fx.prisma.documentChunk.findUniqueOrThrow({
        where: { id: chunk.id },
      });
      expect(projected.retrievalCount).toBe(1);
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
      const OTHER_CYCLE = new Date(CYCLE_START.getTime() + 10 * 24 * HOUR);

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
          new Date(CYCLE_START.getTime() + HOUR),
        );
        await spend(
          other.organizationId,
          70n,
          new Date(OTHER_CYCLE.getTime() + HOUR),
        );

        // Both counters drifted.
        await counter.charge(tenant.organizationId, CYCLE_START, 999n);
        await counter.charge(other.organizationId, OTHER_CYCLE, 888n);

        jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(
            new Map([
              [tenant.organizationId, CYCLE_START],
              [other.organizationId, OTHER_CYCLE],
            ]),
          );

        await reconciliation.reconcileAll();

        await expect(
          counter.spentMicros(tenant.organizationId, CYCLE_START),
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

        jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(new Map([[other.organizationId, OTHER_CYCLE]]));

        await reconciliation.reconcileAll();

        // Under the OTHER tenant's cycle — the date the broken version would
        // have used for everybody — nothing was written.
        await expect(
          counter.spentMicros(other.organizationId, CYCLE_START),
        ).resolves.toBe(0n);
      });

      it('22. **SKIPS a tenant whose cycle cannot be resolved**, rather than guessing', async () => {
        // Reconciling against a guessed cycle is worse than not reconciling:
        // the drift stays AND a wrong number is written somewhere nothing
        // reads. Skipping leaves the existing drift for the next hourly run.
        await spend(
          tenant.organizationId,
          25n,
          new Date(CYCLE_START.getTime() + HOUR),
        );
        await counter.charge(tenant.organizationId, CYCLE_START, 999n);

        jest
          .spyOn(
            fx.moduleRef.get(AuthReferenceService),
            'listOrganizationCycles',
          )
          .mockResolvedValue(new Map());

        await expect(reconciliation.reconcileAll()).resolves.toBe(0);

        // Untouched — still drifted, and still correctable next hour.
        await expect(
          counter.spentMicros(tenant.organizationId, CYCLE_START),
        ).resolves.toBe(999n);
      });
    });
  });
});

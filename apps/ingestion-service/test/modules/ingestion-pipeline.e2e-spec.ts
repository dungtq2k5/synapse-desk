import {
  AiGenerationPurpose,
  DocumentStatus,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
  IngestionJobStatus,
  QDRANT_PAYLOAD_FIELDS,
} from '@synapsedesk/common';
import Redis from 'ioredis';
import { waitFor } from '@synapsedesk/common/testing/wait';
import {
  BUDGET_MICROS,
  CYCLE_START,
  E2eFixture,
  bootstrapE2eTest,
  buildPdf,
} from '../utils';
import { buildTenant, createDocument, TenantFixture } from '../factories';
import { IngestionProcessor } from '../../src/modules/ingestion/ingestion.processor';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { QUOTA_REDIS } from '../../src/modules/ai-ledger/quota-counter.service';

describe('§3 The ingestion pipeline (e2e)', () => {
  let fx: E2eFixture;
  let processor: IngestionProcessor;
  let qdrant: QdrantService;
  let redis: Redis;

  let downloadObject: jest.SpyInstance;
  let getAiEntitlement: jest.SpyInstance;

  let tenant: TenantFixture;

  /**
   * A markdown document with real headings, so the chunker's structure pass has
   * something to split on and the chunks carry a heading path a citation could
   * name.
   */
  const markdownFixture = (sections: number): Buffer => {
    const body = Array.from({ length: sections }, (_, index) =>
      [
        `## Section ${index + 1}`,
        '',
        `This section covers policy area ${index + 1}. `.repeat(20),
        '',
        `### Subsection ${index + 1}.1`,
        '',
        `Detailed guidance for area ${index + 1} follows here. `.repeat(20),
        '',
      ].join('\n'),
    ).join('\n');

    return Buffer.from(`# Employee Handbook\n\n${body}`, 'utf8');
  };

  /** Creates the document + its job row, as `confirmDocument` would. */
  const queueDocument = async (
    overrides: Parameters<typeof createDocument>[2] = {},
  ) => {
    const document = await createDocument(fx.prisma, tenant, {
      fileType: 'md',
      ...overrides,
    });
    const job = await fx.prisma.ingestionJob.create({
      data: {
        documentId: document.id,
        bullmqJobId: '',
        status: IngestionJobStatus.QUEUED,
      },
    });

    return {
      organizationId: tenant.organizationId,
      documentId: document.id,
      ingestionJobId: job.id,
      objectPath: document.fileUrl,
      fileType: document.fileType,
    };
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    processor = fx.moduleRef.get(IngestionProcessor);
    qdrant = fx.moduleRef.get(QdrantService);
    redis = fx.moduleRef.get<Redis>(QUOTA_REDIS);

    // storage-service is not running for this suite. The BYTES are the thing
    // under test's input, so controlling them directly is both simpler and
    // more precise than uploading a fixture to an emulator first.
    downloadObject = jest.spyOn(
      fx.moduleRef.get(StorageReferenceService),
      'downloadObject',
    );

    // Nor is auth-service. The entitlement is the variable the budget tests
    // want to control anyway.
    getAiEntitlement = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'getAiEntitlement',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    await redis.flushdb();
    jest.clearAllMocks();
    fx.embeddings.reset();

    downloadObject.mockResolvedValue(markdownFixture(2));
    getAiEntitlement.mockResolvedValue({
      budgetMicros: BUDGET_MICROS,
      billingCycleStart: CYCLE_START,
    });

    tenant = buildTenant();
  });

  afterAll(async () => {
    await fx.close();
  });

  afterEach(async () => {
    // Qdrant is shared with rag-service's suite and lives outside the database
    // TRUNCATE, so points survive `reset()` unless something removes them.
    // Left behind, they accumulate across runs and eventually make a count
    // assertion fail for reasons that have nothing to do with the test.
    const documents = await fx.prisma.document.findMany({
      select: { id: true },
    });
    for (const document of documents) {
      await qdrant.deleteDocumentPoints(document.id);
    }
  });

  describe('the happy path', () => {
    it('1. Walks every status to COMPLETED', async () => {
      const data = await queueDocument();

      await expect(processor.process(data)).resolves.toBe('INDEXED');

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });

      expect(job.status).toBe(IngestionJobStatus.COMPLETED);
      expect(job.processedAt).not.toBeNull();
      expect(job.errorLog).toBeNull();
      expect(document.status).toBe(DocumentStatus.INDEXED);
    });

    it('2. Writes chunks carrying the HEADING PATH, which is what a citation names', async () => {
      const data = await queueDocument();

      await processor.process(data);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
        orderBy: { chunkIndex: 'asc' },
      });

      expect(chunks.length).toBeGreaterThan(1);
      // The path, not just the nearest heading. "### Subsection 1.1" alone is
      // nearly as ambiguous as nothing; under "## Section 1" it is located.
      expect(
        chunks.some((chunk) =>
          chunk.contentText.includes('Section 1 › Subsection 1.1'),
        ),
      ).toBe(true);
    });

    it('3. Carries all four SCOPE columns onto every chunk', async () => {
      // The precondition for the lexical arm's half of the boundary. A chunk
      // with a NULL organization_id is a chunk no tenant filter excludes —
      // this test guards the precondition, not the filter.
      const data = await queueDocument({
        isOrganizationWide: false,
        departmentLinks: { create: [{ departmentId: tenant.departmentId }] },
      });

      await processor.process(data);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.organizationId).toBe(tenant.organizationId);
        expect(chunk.isOrganizationWide).toBe(false);
        expect(chunk.departmentIds).toEqual([tenant.departmentId]);
        expect(chunk.isDeleted).toBe(false);
      }
    });

    it('4. Gives every Qdrant point the SAME four payload fields', async () => {
      // 12-doc §3 test 3. The filter is worthless if the payload is missing:
      // a filter excludes nothing by a field it cannot see, so an omission
      // here is a cross-tenant disclosure with no failing query anywhere.
      const data = await queueDocument({
        isOrganizationWide: false,
        departmentLinks: { create: [{ departmentId: tenant.departmentId }] },
      });

      await processor.process(data);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });
      const points = await qdrant.retrieve(
        chunks.map((chunk) => chunk.vectorPointId!),
      );

      expect(points).toHaveLength(chunks.length);
      for (const point of points) {
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.organizationId]).toBe(
          tenant.organizationId,
        );
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.isOrganizationWide]).toBe(
          false,
        );
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.departmentIds]).toEqual([
          tenant.departmentId,
        ]);
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.isDeleted]).toBe(false);
        expect(point.payload?.[QDRANT_PAYLOAD_FIELDS.chunkId]).toBeDefined();
      }
    });

    it('5. Embeds through the model the SETTINGS LAYER resolved', async () => {
      // Not a literal typed at the call site — doc 15 §1.2, asserted rather
      // than assumed, because the whole layer is worthless if one caller
      // bypasses it.
      const data = await queueDocument();

      await processor.process(data);

      expect(fx.embeddings.calls.length).toBeGreaterThan(0);
      for (const call of fx.embeddings.calls) {
        expect(call.model).toBe(EMBEDDING_MODEL);
      }
    });

    it('6. Produces a document with NO chunks without failing it', async () => {
      // A cover sheet or an image-only scan. INDEXED with zero chunks is the
      // truthful state; FAILED would send someone hunting a bug that is not
      // there.
      downloadObject.mockResolvedValue(Buffer.from('tiny', 'utf8'));
      const data = await queueDocument();

      await expect(processor.process(data)).resolves.toBe('INDEXED');

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(job.status).toBe(IngestionJobStatus.COMPLETED);
      await expect(
        fx.prisma.documentChunk.count({
          where: { documentId: data.documentId },
        }),
      ).resolves.toBe(0);
    });
  });

  describe('PDF page attribution', () => {
    it('6b. Attributes each chunk to the PAGE it came from', async () => {
      // §3 test 2 — the citation payload. "Page 4, §2.1" is a fact about the
      // document, and the only place it can be recovered is during parsing:
      // the default PDF extraction concatenates everything into one string,
      // and reconstructing page boundaries afterwards means guessing at form
      // feeds. That is how "page 4" becomes approximately page 4.
      downloadObject.mockResolvedValue(
        await buildPdf([
          'Expense policy for domestic travel claims.',
          'Expense policy for international travel claims.',
          'Leave policy for statutory holiday entitlement.',
        ]),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
        orderBy: { chunkIndex: 'asc' },
      });

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      // Ascending and 1-based. A zero-based page number is a citation that is
      // wrong by one for the whole corpus — plausible enough that nobody
      // reports it and everybody stops trusting the links.
      expect(chunks[0].pageNumber).toBe(1);
      expect(new Set(chunks.map((chunk) => chunk.pageNumber))).toEqual(
        new Set([1, 2, 3]),
      );

      const international = chunks.find((chunk) =>
        chunk.contentText.includes('international'),
      );
      expect(international?.pageNumber).toBe(2);
    });
  });

  describe('observability', () => {
    it('6c. Is LOCATABLE mid-flight, not silently PARSING for ten minutes', async () => {
      // §3 test 8, and the assertion is deliberately made WHILE the job runs.
      //
      // The purpose of RDM Table 20 is that a stuck 200-page PDF can be found:
      // someone looking at the document sees which phase it is in. Asserting
      // the transitions after the fact would pass for an implementation that
      // wrote every status at the very end — which tells an operator staring
      // at a hung job exactly nothing.
      let releaseDownload: (bytes: Buffer) => void = () => undefined;
      downloadObject.mockReturnValue(
        new Promise<Buffer>((resolve) => {
          releaseDownload = resolve;
        }),
      );

      const data = await queueDocument();
      const running = processor.process(data);

      // PARSING, observable from another connection while the download hangs.
      await waitFor(async () => {
        const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
          where: { id: data.ingestionJobId },
        });
        return job.status === String(IngestionJobStatus.PARSING);
      });

      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });
      // And the DOCUMENT says PROCESSING, so the knowledge-base list shows a
      // document being worked on rather than one stuck at PENDING.
      expect(document.status).toBe(DocumentStatus.PROCESSING);

      releaseDownload(markdownFixture(4));
      await expect(running).resolves.toBe('INDEXED');

      const finished = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(finished.status).toBe(IngestionJobStatus.COMPLETED);
    });

    it('6d. Reaches EMBEDDING as a distinct phase, not straight from PARSING', async () => {
      // CHUNKING and EMBEDDING being distinct is what makes a stuck job
      // ATTRIBUTABLE: "it has been embedding for ten minutes" and "it has been
      // parsing for ten minutes" point at different subsystems.
      let releaseEmbedding: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseEmbedding = resolve;
      });

      const embedBatch = jest
        .spyOn(fx.embeddings, 'embedBatch')
        .mockImplementation(async (texts: string[], model: string) => {
          await gate;
          embedBatch.mockRestore();
          return fx.embeddings.embedBatch(texts, model);
        });

      const data = await queueDocument();
      const running = processor.process(data);

      await waitFor(async () => {
        const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
          where: { id: data.ingestionJobId },
        });
        return job.status === String(IngestionJobStatus.EMBEDDING);
      });

      releaseEmbedding();
      await expect(running).resolves.toBe('INDEXED');
    });
  });

  describe('metering', () => {
    it('7. Writes one EMBEDDING ledger row per batch, not per chunk', async () => {
      // Per chunk, `ai_generations` would be dominated by ingestion noise and
      // the retention rollups that exist to control its size would be fighting
      // a problem batching removes for free.
      const data = await queueDocument();

      await processor.process(data);
      await waitFor(
        async () =>
          (await fx.prisma.aiGeneration.count()) === fx.embeddings.calls.length,
      );

      const rows = await fx.prisma.aiGeneration.findMany();
      expect(rows).toHaveLength(fx.embeddings.calls.length);
      for (const row of rows) {
        expect(row.purpose).toBe(AiGenerationPurpose.EMBEDDING);
        expect(row.modelName).toBe(EMBEDDING_MODEL);
        expect(row.promptTokens).toBeGreaterThan(0);
        // An embedding has no completion side at all, so a non-zero value here
        // would mean the cost was computed against a rate that cannot apply.
        expect(row.completionTokens).toBe(0);
        expect(row.estimatedCostMicros).toBeGreaterThan(0n);
        // System work: nobody is waiting on this, and attributing the spend to
        // whoever uploaded the file hours ago would be a guess.
        expect(row.userId).toBeNull();
      }
    });

    it('8. CHARGES the counter before recording, and the counter is non-zero', async () => {
      const data = await queueDocument();

      await processor.process(data);

      const keys = await redis.keys('quota:*');
      expect(keys).toHaveLength(1);
      expect(Number(await redis.get(keys[0]))).toBeGreaterThan(0);
    });

    it('9. Batches at EMBEDDING_BATCH_SIZE rather than sending everything at once', async () => {
      downloadObject.mockResolvedValue(markdownFixture(40));
      const data = await queueDocument();

      await processor.process(data);

      expect(fx.embeddings.calls.length).toBeGreaterThan(1);
      for (const call of fx.embeddings.calls) {
        expect(call.texts.length).toBeLessThanOrEqual(EMBEDDING_BATCH_SIZE);
      }
    });
  });

  describe('the budget cap', () => {
    it('10. Leaves the job QUEUED rather than FAILED when the tenant is at the cap', async () => {
      // RDM §1.14. A tenant who overspent on chat must not also lose document
      // onboarding, and FAILED discards parsing work already done.
      getAiEntitlement.mockResolvedValue({
        budgetMicros: 0n,
        billingCycleStart: CYCLE_START,
      });
      const data = await queueDocument();

      await expect(processor.process(data)).resolves.toBe('DEFERRED');

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });

      expect(job.status).toBe(IngestionJobStatus.QUEUED);
      expect(job.errorLog).toBeNull();
      expect(document.status).toBe(DocumentStatus.PENDING);
      expect(fx.embeddings.calls).toHaveLength(0);
    });

    it('11. KEEPS the parsing work, so a cycle roll resumes at the embedding step', async () => {
      // The reason the deferral is not a failure. Chunk rows survive with no
      // vector_point_id, which is exactly the state a re-run picks up.
      getAiEntitlement.mockResolvedValue({
        budgetMicros: 0n,
        billingCycleStart: CYCLE_START,
      });
      const data = await queueDocument();

      await processor.process(data);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.vectorPointId === null)).toBe(true);
    });

    it('12. Drains on the next run once the cycle rolls', async () => {
      getAiEntitlement.mockResolvedValue({
        budgetMicros: 0n,
        billingCycleStart: CYCLE_START,
      });
      const data = await queueDocument();
      await processor.process(data);

      // A new cycle is a new Redis key — no explicit cache bust, which is the
      // whole point of putting the cycle in the key.
      getAiEntitlement.mockResolvedValue({
        budgetMicros: BUDGET_MICROS,
        billingCycleStart: new Date('2026-09-01T00:00:00.000Z'),
      });

      await expect(processor.process(data)).resolves.toBe('INDEXED');

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });
      expect(chunks.every((chunk) => chunk.vectorPointId !== null)).toBe(true);
    });
  });

  describe('failure and recovery', () => {
    it('13. Records the failure on the JOB ROW, where a human will find it', async () => {
      fx.embeddings.failNext = new Error('embedding provider is down');
      const data = await queueDocument();

      await expect(processor.process(data)).rejects.toThrow(
        'embedding provider is down',
      );

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });

      expect(job.status).toBe(IngestionJobStatus.FAILED);
      expect(job.errorLog).toContain('embedding provider is down');
      expect(document.status).toBe(DocumentStatus.FAILED);
    });

    it('14. Leaves chunks WITHOUT a vector_point_id when embedding fails', async () => {
      // The write-back ordering, from the failure side: Postgres must never
      // claim vectors that were not stored, because nothing downstream can
      // tell the difference.
      fx.embeddings.failNext = new Error('embedding provider is down');
      const data = await queueDocument();

      await processor.process(data).catch(() => undefined);

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.vectorPointId === null)).toBe(true);
    });

    it('15. COMPLETES the leftovers on a re-run', async () => {
      // The recovery the nullable column exists for: a re-run embeds exactly
      // the chunks that still have no vector, rather than starting over.
      fx.embeddings.failNext = new Error('transient');
      const data = await queueDocument();
      await processor.process(data).catch(() => undefined);

      await expect(processor.process(data)).resolves.toBe('INDEXED');

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: data.documentId },
      });
      expect(chunks.every((chunk) => chunk.vectorPointId !== null)).toBe(true);
      await expect(qdrant.countPoints(data.documentId)).resolves.toBe(
        chunks.length,
      );
    });

    it('16. Is IDEMPOTENT: two clean runs leave one set of chunks', async () => {
      // NATS core redelivers routinely, so a second run of the same document
      // is the ordinary case. Appending would double every chunk and orphan
      // the first set in Qdrant with no row pointing at it.
      const data = await queueDocument();

      await processor.process(data);
      const first = await fx.prisma.documentChunk.count({
        where: { documentId: data.documentId },
      });

      await processor.process(data);
      const second = await fx.prisma.documentChunk.count({
        where: { documentId: data.documentId },
      });

      expect(second).toBe(first);
    });

    it('17. FAILS a file type it has no parser for', async () => {
      const data = await queueDocument({ fileType: 'xlsx' });

      await expect(processor.process(data)).rejects.toThrow(/xlsx/);

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(job.status).toBe(IngestionJobStatus.FAILED);
    });
  });
});

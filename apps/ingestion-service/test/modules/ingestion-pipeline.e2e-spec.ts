import {
  AiGenerationPurpose,
  DocumentStatus,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
  IngestionJobStatus,
  QDRANT_PAYLOAD_FIELDS,
  DocumentFlagResolution,
  DocumentFlagSeverity,
  DocumentFlagType,
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
import { memberContext } from '../utils/context';
import { IngestionProcessor } from '../../src/modules/ingestion/ingestion.processor';
import { DocumentFlagsService } from '../../src/modules/document-flags/document-flags.service';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { QUOTA_REDIS } from '../../src/modules/ai-ledger/quota-counter.service';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('The ingestion pipeline (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw.
  const faults = faultInjector();

  let fx: E2eFixture;
  let processor: IngestionProcessor;
  let documentFlags: DocumentFlagsService;
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
        organizationId: tenant.organizationId,
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
    documentFlags = fx.moduleRef.get(DocumentFlagsService);
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
      // The filter is worthless if the payload is missing:
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
      // Not a literal typed at the call site, asserted rather
      // than assumed, because the whole layer is worthless if one caller
      // bypasses it.
      const data = await queueDocument();

      await processor.process(data);

      expect(fx.embeddings.calls.length).toBeGreaterThan(0);
      for (const call of fx.embeddings.calls) {
        expect(call.model).toBe(EMBEDDING_MODEL);
      }
    });

    it('6. **A document with NO extractable text FAILS, with a reason**', async () => {
      // This asserted the opposite once: zero chunks reported
      // INDEXED, on the reasoning that FAILED "would send someone hunting for
      // a bug". That holds for a generic failure and not for a NAMED one.
      //
      // The tenant-visible consequence was the problem. A Knowledge Manager
      // uploads a scanned handbook, the system reports it indexed, and it
      // returns nothing in search forever — with the only evidence in a log
      // line they will never see. A log is not a feedback channel to the
      // person who caused the problem.
      downloadObject.mockResolvedValue(Buffer.from('tiny', 'utf8'));
      const data = await queueDocument();

      await expect(processor.process(data)).rejects.toThrow(
        /no extractable text/i,
      );

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(job.status).toBe(IngestionJobStatus.FAILED);
      // **The reason lands on the JOB ROW**, which is what RDM Table 20 exists
      // for: a stuck document is diagnosable by someone looking at the
      // document, not by someone who knows to grep a container's stdout.
      expect(job.errorLog).toMatch(/no extractable text/i);

      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });
      expect(document.status).toBe(DocumentStatus.FAILED);
    });

    it('6a. **a PDF OCR could not read names LANGUAGE as the cause**', async () => {
      // And the message changed because the system did. It used to
      // end "run OCR on it first", which stops making sense once we run OCR
      // ourselves: by the time a PDF reaches this error every image page has
      // been rasterized and read and still produced nothing.
      //
      // Language is what remains actionable — it is the one input the uploader
      // controls, and tesseract given the wrong one does not fail, it returns
      // confident nonsense that falls below the chunker's minimum.
      downloadObject.mockResolvedValue(await buildPdf([' ']));
      const data = await queueDocument({ fileType: 'pdf' });

      await expect(processor.process(data)).rejects.toThrow(/language/i);

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(job.errorLog).toMatch(/language/i);
      // The advice that no longer applies is gone, not merely supplemented.
      expect(job.errorLog).not.toMatch(/run OCR on it first/i);
    });

    it('and the error log never contains document TEXT', async () => {
      // `error_log` is operator-facing and the document is tenant
      // content — the same rule that applies to detection logs.
      const secret = 'CONFIDENTIAL-ACQUISITION-PROJECT-CODENAME';
      downloadObject.mockResolvedValue(
        await buildPdf([`  ${secret}  `], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await expect(processor.process(data)).rejects.toThrow();

      const job = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: data.ingestionJobId },
      });
      expect(job.errorLog ?? '').not.toContain(secret);
    });
  });

  /**
   * **Every page is either in the corpus or recorded as missing**.
   *
   * The invariant that closes BOTH silent drops. They fail identically from
   * outside — the document reports INDEXED and part of it is simply not
   * searchable — so the check compares page numbers in the chunk rows against
   * the page count the parser saw, which catches either.
   */
  describe('Pages that did not reach the corpus', () => {
    const flagsFor = (documentId: string) =>
      fx.prisma.documentFlag.findMany({ where: { documentId } });

    // A page that lands in the GAP between the two thresholds
    //
    // 61 characters, so it clears the parser's `MIN_PAGE_CHARACTERS` of 32 and
    // is never sent to OCR; 13 tokens, so it falls under the chunker's
    // `MIN_CHUNK_TOKENS` of 16 and is discarded there. That gap is precisely
    // where a page used to disappear having been counted a success, and a
    // fixture landing anywhere else would test a different drop.
    const THIN_PAGE =
      'Appendix C — Signature page, retained for the records office.';

    // Long enough to survive both, with `repeat: 1` so the thin page above is
    // not padded alongside it.
    const FULL_PAGE =
      'The annual leave policy grants twelve paid days each year and permits ' +
      'five of them to carry over into the following year, provided they are ' +
      'used before the thirty-first of March.';

    it('**a page dropped by the CHUNKER is flagged, not silently lost**', async () => {
      // The second drop point, and the one closing the parser alone would
      // have missed: this page has text, so the parser keeps it — and then it
      // falls under `MIN_CHUNK_TOKENS` and vanishes at chunking having been
      // counted a success.
      //
      // `repeat: 1` is what makes it thin; the fixture defaults to 40 for
      // exactly this reason.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);

      const flags = await flagsFor(data.documentId);

      expect(flags).toHaveLength(1);
      expect(flags[0].flagType).toBe(DocumentFlagType.PAGES_NOT_INDEXED);
      // **WARNING, not the INFO default** — a one-word omission is what would
      // bury this under the `UNRETRIEVED` noise in the worklist.
      expect(flags[0].severity).toBe(DocumentFlagSeverity.WARNING);
      expect(flags[0].detail).toMatch(/page/i);
    });

    it('**re-raises after a FIXED retry that still cannot read the pages**', async () => {
      // The end-to-end case the policy exists for. Someone sees the flag,
      // retries ingestion with different OCR languages, the parser still drops
      // the page — and the flag that says "your fix did not work" is precisely
      // the one the old rule silenced, because the earlier row was resolved.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const first = await queueDocument({ fileType: 'pdf' });
      await processor.process(first);

      const [raised] = await flagsFor(first.documentId);
      await documentFlags.resolve(
        raised.id,
        DocumentFlagResolution.FIXED,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
      );

      // The retry: same document, a new job, and a parse that fails the same
      // way.
      const retry = await fx.prisma.ingestionJob.create({
        data: {
          organizationId: tenant.organizationId,
          documentId: first.documentId,
          bullmqJobId: '',
          status: IngestionJobStatus.QUEUED,
        },
      });
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      await processor.process({ ...first, ingestionJobId: retry.id });

      const flags = await flagsFor(first.documentId);
      expect(flags).toHaveLength(2);
      expect(flags.filter((flag) => flag.resolvedAt === null)).toHaveLength(1);
    });

    it('**a clean re-index CLOSES the flag, as a system resolution**', async () => {
      // Nothing else closes it. After doc 41 resolution is a human act, so an
      // unresolved flag would mean "no human has looked" rather than "pages are
      // still missing" — a worklist item nobody can action, and a warning that
      // never clears for anything reader-facing derived from it.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const first = await queueDocument({ fileType: 'pdf' });
      await processor.process(first);

      const [raised] = await flagsFor(first.documentId);
      expect(raised.resolvedAt).toBeNull();

      // The fix: re-ingest with every page readable this time.
      const retry = await fx.prisma.ingestionJob.create({
        data: {
          organizationId: tenant.organizationId,
          documentId: first.documentId,
          bullmqJobId: '',
          status: IngestionJobStatus.QUEUED,
        },
      });
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, FULL_PAGE], { repeat: 1 }),
      );
      await processor.process({ ...first, ingestionJobId: retry.id });

      const [after] = await flagsFor(first.documentId);
      expect(after.resolvedAt).not.toBeNull();
      expect(after.resolution).toBe(DocumentFlagResolution.FIXED);
      // No actor: the pipeline closed it, not a person.
      expect(after.resolvedById).toBeNull();
    });

    it('**does NOT overwrite a human’s resolution**', async () => {
      // Conditional on `resolvedAt: null`. A Knowledge Manager who dismissed
      // this — "the appendix really is a photograph" — keeps their decision and
      // their reason.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const first = await queueDocument({ fileType: 'pdf' });
      await processor.process(first);

      const [raised] = await flagsFor(first.documentId);
      await documentFlags.resolve(
        raised.id,
        DocumentFlagResolution.DISMISSED,
        memberContext({
          id: tenant.userId,
          organizationId: tenant.organizationId,
        }),
        'the appendix is a photograph',
      );

      const retry = await fx.prisma.ingestionJob.create({
        data: {
          organizationId: tenant.organizationId,
          documentId: first.documentId,
          bullmqJobId: '',
          status: IngestionJobStatus.QUEUED,
        },
      });
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, FULL_PAGE], { repeat: 1 }),
      );
      await processor.process({ ...first, ingestionJobId: retry.id });

      const [after] = await flagsFor(first.documentId);
      expect(after.resolution).toBe(DocumentFlagResolution.DISMISSED);
      expect(after.resolutionComment).toBe('the appendix is a photograph');
      expect(after.resolvedById).toBe(tenant.userId);
    });

    it('and the document still INDEXES — 197 good pages beat discarding 200', async () => {
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await expect(processor.process(data)).resolves.toBe('INDEXED');

      const document = await fx.prisma.document.findUniqueOrThrow({
        where: { id: data.documentId },
      });
      expect(document.status).toBe(DocumentStatus.INDEXED);
    });

    it('**the flag names page numbers and never document text**', async () => {
      // `DocumentFlag.detail` is `@db.Text` and operator-facing,
      // which puts it under the same rule as `error_log` — and it is the field
      // most likely to grow a helpful excerpt later.
      // 50 characters and 12 tokens — in the same gap as `THIN_PAGE`, so the
      // page is kept by the parser and dropped by the chunker. The original
      // wording measured 16 tokens exactly and survived, which is a reminder
      // that the boundary here is TOKENS and the eye counts characters.
      const secret = 'Signature page for codename BLUEHARVEST, retained.';
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, secret], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);

      const [flag] = await flagsFor(data.documentId);

      expect(flag.detail).not.toContain('BLUEHARVEST');
      expect(flag.detail).toMatch(/1 of 2 page/);
    });

    it('**processing the same document twice raises ONE flag**', async () => {
      // Reachable today: BullMQ retries a failed job, and the flag is written
      // before the steps that can still fail — so a job that flags three
      // missing pages and then dies at the Qdrant upsert comes back and writes
      // the finding a second time. The worklist would show one document twice.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);
      await processor.process(data);

      expect(await flagsFor(data.documentId)).toHaveLength(1);
    });

    it('**and a DISMISSED flag is never re-raised**', async () => {
      // The rule `DocumentFlagWriter` spends a paragraph on: a human
      // dismissing a flag is a decision, and re-raising it is arguing with
      // them until they stop reading the worklist. A Knowledge Manager who
      // confirms the appendix really is a photograph must not be overruled by
      // the next re-ingestion.
      downloadObject.mockResolvedValue(
        await buildPdf([FULL_PAGE, THIN_PAGE], { repeat: 1 }),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);
      await fx.prisma.documentFlag.updateMany({
        where: { documentId: data.documentId },
        data: { resolvedAt: new Date() },
      });

      await processor.process(data);

      const flags = await flagsFor(data.documentId);
      expect(flags).toHaveLength(1);
      expect(flags[0].resolvedAt).not.toBeNull();
    });

    it('a fully indexed document raises NO flag', async () => {
      // The over-reporting direction. A worklist that flags every document is
      // a worklist nobody opens.
      downloadObject.mockResolvedValue(
        await buildPdf([
          'Page one of the handbook',
          'Page two of the handbook',
        ]),
      );
      const data = await queueDocument({ fileType: 'pdf' });

      await processor.process(data);

      expect(await flagsFor(data.documentId)).toEqual([]);
    });

    it('and a format with no pages is never checked', async () => {
      // A DOCX has no pages until something paginates it, so there is nothing
      // that could have gone missing and nothing to compare against.
      const data = await queueDocument({ fileType: 'md' });

      await processor.process(data);

      expect(await flagsFor(data.documentId)).toEqual([]);
    });
  });

  describe('PDF page attribution', () => {
    it('6b. Attributes each chunk to the PAGE it came from', async () => {
      // test 2 — the citation payload. "Page 4, §2.1" is a fact about the
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
      // and the assertion is deliberately made WHILE the job runs.
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

      // Restores itself so the SECOND call runs for real — and is registered
      // with the injector too, so a failure before the gate opens does not
      // leave the whole embedding client mocked for the rest of the file.
      const embedBatch = faults.replace(
        fx.embeddings,
        'embedBatch',
        async (texts: string[], model: string) => {
          await gate;
          embedBatch.mockRestore();
          return fx.embeddings.embedBatch(texts, model);
        },
      );

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

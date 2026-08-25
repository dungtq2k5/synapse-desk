import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AiGenerationPurpose,
  AiGenerationStatus,
  AiSurface,
  DOCUMENT_PATTERNS,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
  EMBEDDING_BATCH_SIZE,
  IngestionJobStatus,
  MAX_CHUNKS_PER_DOCUMENT,
  QDRANT_UPSERT_BATCH,
  TERMINAL_INGESTION_STATUSES,
  estimateCostMicros,
  formatErrorMsg,
  parseOcrLanguages,
  systemContext,
} from '@synapsedesk/common';
import {
  INGESTION_OUTCOMES,
  type IngestionOutcome,
} from '../../common/configs/ingestion.config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import { AiLedgerService } from '../ai-ledger/ai-ledger.service';
import { AiSettingsService } from '../ai-settings/ai-settings.service';
import { QdrantService, ChunkPoint } from '../qdrant/qdrant.service';
import { DocumentEventPublisher } from '../events/document-event.publisher';
import {
  EMBEDDING_CLIENT,
  EmbeddingClient,
} from '../embeddings/embedding.contract';
import {
  DocumentParserService,
  ParsedDocument,
} from './document-parser.service';
import { MAX_OCR_PAGES } from './ocr.service';
import { Chunk, DocumentChunkerService } from './document-chunker.service';
import { DocumentFlagWriter } from '../scheduled/document-flag-writer';

export type IngestionJobData = {
  organizationId: string;
  documentId: string;
  ingestionJobId: string;
  objectPath: string;
  fileType: string;
  /**
   * ISO 639-1 codes for OCR.
   *
   * Optional because jobs enqueued before this field existed are still in
   * Redis, and a worker that crashed on them would stall every document behind
   * them. Absent reads as "not specified", which is what it was.
   */
  ocrLanguages?: string[];
};

/** Raised when the tenant is out of AI budget. Not a failure — a deferral. */
class BudgetExhausted extends Error {}

/**
 * Raised when the job row reached a terminal status underneath the worker.
 *
 * Handled by `process()`, which returns `'CANCELLED'`. It must never reach
 * `fail()` or escape the processor.
 */
export class JobNoLongerRunnableError extends Error {
  constructor(ingestionJobId: string) {
    super(`Ingestion job ${ingestionJobId} is no longer runnable`);
  }
}

/**
 * Raised when a document would produce more chunks than the ceiling allows.
 *
 * **Terminal by construction, and that is the whole point of the type.** It is
 * caught above the generic arm and returns rather than rethrows, because
 * `attempts: 3` on a deterministic failure spends the embedding budget twice
 * more on a document that cannot succeed. `MAX_CHUNKS_PER_DOCUMENT`'s docblock
 * carries the arithmetic; this carries the retry decision.
 *
 * Same shape as `BudgetExhausted`, `JobNoLongerRunnableError`, `ExportTooLarge`
 * and `UnprocessableMessage` — a typed error caught above the retrying arm,
 * which is now the fourth time this codebase has wanted one.
 */
class DocumentTooComplex extends Error {
  constructor(chunks: number) {
    super(
      `Document produces ${chunks.toLocaleString()} chunks, over the ` +
        `${MAX_CHUNKS_PER_DOCUMENT.toLocaleString()} ceiling. Split it into ` +
        `smaller documents — retrying will not change the outcome.`,
    );
  }
}

/**
 * Raised when a document parses to no text at all.
 *
 * **A named failure rather than a silent success.** It reaches `fail()` like
 * any other error, so the reason lands in `ingestion_jobs.error_log`, which is
 * where a Knowledge Manager looking at a stuck document will actually find it.
 *
 * The wording names the likely cause rather than describing the symptom: for a
 * PDF, no extractable text almost always means the pages are images. Saying so
 * is the cheap half of the scanned-PDF detection that OCR would complete.
 */
class NoExtractableText extends Error {
  constructor(fileType: string) {
    super(
      fileType === 'pdf'
        ? // **The advice changed because the system changed.**
          // It used to end "run OCR on it first", which stops making sense
          // once we run OCR ourselves: by the time a PDF reaches this error,
          // every image page has been rasterized and read and still produced
          // nothing.
          //
          // So the actionable input is LANGUAGE, because it is the one thing
          // the uploader controls and the most likely cause — tesseract given
          // the wrong language does not fail, it returns confident nonsense
          // that then falls below the chunker's minimum.
          'OCR found no readable text in this document. If it is not in ' +
            'English, re-upload it specifying its language.'
        : `No extractable text was found in this ${fileType} document.`,
    );
  }
}

/**
 * Raised when a document needed OCR and OCR is not installed on this deployment.
 *
 * **Separate from `NoExtractableText` because the reader is different.** That
 * error tells an uploader their file might be in the wrong language, which is
 * advice they can act on. Here the file is fine and the server is not, so the
 * same advice sends a Knowledge Manager to re-upload a document that will fail
 * again identically — and, worse, leaves nobody looking at the actual fault.
 *
 * @param pageCount how many pages needed OCR and could not get it.
 */
class OcrUnavailable extends Error {
  constructor(pageCount: number) {
    super(
      `This document needs OCR for ${pageCount} page(s) and OCR is not ` +
        'available on this deployment. This is a server configuration ' +
        'problem, not a problem with the file — no re-upload will change it. ' +
        'Contact your administrator.',
    );
  }
}

/**
 * `QUEUED → PARSING → CHUNKING → EMBEDDING → COMPLETED | FAILED`.
 *
 * Three orderings here are load-bearing and each has a failure behind it:
 *
 *   - **Chunk rows are written BEFORE the Qdrant upsert, and
 *     `vector_point_id` is written back AFTER it.** Reversed, a failed upsert
 *     leaves Postgres claiming vectors that were never stored, and nothing
 *     downstream can tell — the lexical arm would happily return chunks the
 *     semantic arm cannot see. This is why the column is nullable at all.
 *   - **Over budget leaves the job `QUEUED`, never `FAILED`** (RDM §1.14). A
 *     tenant who overspent on chat should not also lose document onboarding,
 *     and failing discards parsing work already done.
 *   - **Every embedding batch is charged before it is recorded.** The charge is
 *     awaited; the row is fire-and-forget. Merging them makes the increment
 *     asynchronous and reopens the burst hole the counter exists to close.
 */
@Injectable()
export class IngestionProcessor {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageReferenceService,
    private readonly parser: DocumentParserService,
    private readonly chunker: DocumentChunkerService,
    private readonly flags: DocumentFlagWriter,
    private readonly qdrant: QdrantService,
    private readonly ledger: AiLedgerService,
    private readonly aiSettings: AiSettingsService,
    private readonly events: DocumentEventPublisher,
    @Inject(EMBEDDING_CLIENT) private readonly embeddings: EmbeddingClient,
  ) {}

  /**
   * Runs one document end to end.
   *
   * Returns `'DEFERRED'` when the tenant is at the AI cap, so the queue layer
   * can leave the job alone rather than retrying it into a failure. A thrown
   * error means a genuine failure and is recorded as one.
   */
  async process(data: IngestionJobData): Promise<IngestionOutcome> {
    const { documentId, ingestionJobId, organizationId } = data;

    try {
      await this.setPhase(
        ingestionJobId,
        IngestionJobStatus.PARSING,
        documentId,
        DocumentStatus.PROCESSING,
      );

      const bytes = await this.storage.downloadObject(
        data.objectPath,
        organizationId,
      );
      const parsed = await this.parser.parse(
        bytes,
        data.fileType,
        // From the EVENT, not a database read. `objectPath` and
        // `fileType` are there for the same reason: the worker needs no lookup
        // to start, and this service's only document read happens later,
        // inside `writeChunkRows`.
        //
        // Narrowed HERE, once, and by parsing rather than casting. The column
        // and the wire are both `string[]` and cannot be otherwise; a cast at
        // the tesseract lookup instead would let an unrecognized code drop out
        // of `-l` and OCR the document in English with nothing reporting it.
        // A throw here is a FAILED job carrying the bad code, which is the
        // same trade `NoExtractableText` makes for the neighbouring case.
        //
        // `?? []` is load-bearing on THIS type and dead on the proto message:
        // `IngestionJobData.ocrLanguages` is optional for the pre-field jobs
        // still sitting in Redis, while ts-proto emits `repeated string` as a
        // non-optional `string[]`.
        parseOcrLanguages(data.ocrLanguages ?? []),
      );

      await this.setJobStatus(ingestionJobId, IngestionJobStatus.CHUNKING);
      const chunks = await this.chunker.chunk(parsed.pages);

      // Before `writeChunkRows` and before any embedding call: the ceiling
      // exists to stop the spend, so checking it after paying is checking
      // nothing.
      if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
        throw new DocumentTooComplex(chunks.length);
      }

      if (chunks.length === 0) {
        // **FAILED, with a reason a human can act on.**
        //
        // This used to report INDEXED, reasoning that FAILED "would send
        // someone hunting for a bug". That holds for a GENERIC failure and not
        // for a named one, and the tenant-visible consequence was the problem:
        // a Knowledge Manager uploads a scanned handbook, the system reports it
        // indexed, and it returns nothing in search forever. A log line is not
        // a feedback channel to the person who caused it.
        //
        // Naming "scanned" is the cheap half of the scanned-PDF detection that
        // argues for before OCR exists: a document that parses to no text at
        // all is almost certainly an image, and saying so converts a silent
        // wrong answer into an actionable one.
        //
        // Unless the reason is the deployment. A page that reached OCR and
        // failed on `binary_missing` did not fail because of its language, and
        // telling the uploader to re-upload in another language is advice that
        // cannot work and points away from the real fault.
        const unreadable = parsed.failedPages.filter(
          (page) => page.reason === 'binary_missing',
        );
        if (unreadable.length > 0) {
          // At `error`, per document, and not only once at boot. The boot
          // warning reaches whoever deployed the service — but it is one line
          // in a stream nobody re-reads, and by the time tenants are failing it
          // has scrolled away. This one lives as long as the fault does.
          this.logger.error(
            `Document ${data.documentId}: OCR is unavailable on this ` +
              `deployment; ${unreadable.length} page(s) could not be read`,
          );
          throw new OcrUnavailable(unreadable.length);
        }

        throw new NoExtractableText(data.fileType);
      }

      // **After chunking, because that is where the SECOND drop happens** —
      // `document-chunker.service.ts` discards any chunk under
      // `MIN_CHUNK_TOKENS`, so a page that OCR'd to eight tokens survived the
      // parser, counted as a success, and vanished anyway. Checking the parser's
      // output alone would have reported that document as complete.
      await this.reportMissingPages(data, parsed, chunks);

      // The previous run's points, removed on EVERY run — retry, reindex and
      // replace all arrive here, and a purge per route would be three copies of
      // one rule with three chances to omit it.
      //
      // HERE, below the parse, and that is the whole placement: a parse failure
      // or `NoExtractableText` above leaves the old chunk rows and their points
      // intact and consistent, so a reindex of a file that turns out to be
      // unreadable does not destroy a working index. From this line to the last
      // upsert the document has neither, which is the window `writeChunkRows`
      // already opens by deleting the rows.
      //
      // By document, not by point id: the ids live on the rows the next
      // statement deletes, and nothing captures them first.
      await this.qdrant.deleteDocumentPoints(documentId, organizationId);

      const scope = await this.writeChunkRows(documentId, chunks);

      await this.setJobStatus(ingestionJobId, IngestionJobStatus.EMBEDDING);
      await this.embedAndUpsert(data, scope);

      await this.complete(data, chunks.length);
      return INGESTION_OUTCOMES.INDEXED;
    } catch (error) {
      if (error instanceof JobNoLongerRunnableError) {
        // Returned, not rethrown: `attempts: 3` means a throw here is two more
        // re-runs and a failed-set entry that reads like a genuine failure.
        this.logger.log(
          `Ingestion of ${documentId} stopped: job ${ingestionJobId} is no longer runnable`,
        );

        return INGESTION_OUTCOMES.CANCELLED;
      }

      if (
        error instanceof DocumentTooComplex ||
        error instanceof NoExtractableText ||
        error instanceof OcrUnavailable
      ) {
        // **One arm because it is one rule: a DETERMINISTIC refusal does not
        // retry.** Both are decided by the document's own bytes against fixed
        // settings — the same file, the same chunker and the same OCR languages
        // reach the same verdict on attempt three.
        //
        // `fail()` so the reason lands in `ingestion_jobs.error_log` where a
        // Knowledge Manager will find it — then RETURN, so BullMQ records one
        // failure rather than three.
        //
        // What each retry would waste differs, and neither is free.
        // `DocumentTooComplex` is raised before any embedding call, so a rethrow
        // re-chunks. `NoExtractableText` is raised AFTER the parse, so a rethrow
        // re-rasterizes and re-OCRs every image page — up to
        // `MAX_OCR_PAGES_PER_DOCUMENT` of them — which is the most expensive
        // path in the pipeline, spent to reach a conclusion that cannot change.
        //
        // `OcrUnavailable` is deterministic for a different reason: not the
        // bytes but the deployment. `OcrService` memoises its probe for the life
        // of the process, so attempts two and three re-read the same cached
        // `false` — and installing tesseract is a deploy, which replaces the
        // process anyway. A retry cannot observe the fix even after it lands.
        await this.fail(data, error);
        this.logger.warn(`Refused ${documentId}: ${formatErrorMsg(error)}`);

        return INGESTION_OUTCOMES.REFUSED;
      }

      if (error instanceof BudgetExhausted) {
        // Back to QUEUED, and the document back to PENDING. Both are honest:
        // nothing is wrong, the work is simply waiting for the cycle to roll.
        //
        // `setJobStatus` can refuse, and a throw raised inside a catch block
        // escapes the handler — which is the retried-job outcome the CANCELLED
        // arm above exists to avoid.
        try {
          await this.setPhase(
            ingestionJobId,
            IngestionJobStatus.QUEUED,
            documentId,
            DocumentStatus.PENDING,
          );
        } catch (deferralError) {
          if (deferralError instanceof JobNoLongerRunnableError) {
            this.logger.log(
              `Ingestion of ${documentId} was cancelled while deferring at the AI cap`,
            );

            return INGESTION_OUTCOMES.CANCELLED;
          }

          throw deferralError;
        }

        this.logger.log(
          `Deferred ingestion of ${documentId}: organization ${organizationId} is at the AI cap`,
        );
        return INGESTION_OUTCOMES.DEFERRED;
      }

      await this.fail(data, error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * **Every page is either in the corpus or recorded as missing.**
   *
   * Two silent drops sit between a PDF and the index, and they fail
   * identically from outside — the document reports INDEXED while three of its
   * pages are simply not searchable, forever:
   *
   *   1. the parser drops a page OCR could not read, or never tried past
   *      `MAX_OCR_PAGES_PER_DOCUMENT`;
   *   2. the chunker drops a chunk under `MIN_CHUNK_TOKENS`, so a page that
   *      OCR'd to eight tokens vanishes having been counted a success.
   *
   * Comparing page numbers in the CHUNK ROWS against the count the parser saw
   * catches both at once, which is why the check lives here rather than being
   * instrumented at each drop.
   *
   * **A flag, never a failure.** A 200-page handbook with three unreadable
   * pages is 197 pages of value; discarding it to signal three is a bad trade.
   * Index what worked, and put the rest on a worklist a human already reviews.
   */
  private async reportMissingPages(
    data: IngestionJobData,
    parsed: ParsedDocument,
    chunks: Chunk[],
  ): Promise<void> {
    // Formats without pagination have nothing to check — a DOCX has no pages
    // until something paginates it, so `pageCount` is 0 and there is no page
    // that could have gone missing.
    if (parsed.pageCount === 0) return;

    const indexed = new Set(
      chunks
        .map((chunk) => chunk.pageNumber)
        .filter((page): page is number => page !== null),
    );

    const missing = Array.from(
      { length: parsed.pageCount },
      (_, index) => index + 1,
    ).filter((page) => !indexed.has(page));

    if (missing.length === 0) {
      // **Not just "nothing to raise" — something to CLOSE.** A document whose
      // pages were unreadable and now are not leaves an open flag behind, and
      // nothing else closes it: after doc 41, resolution is a human act. An
      // unresolved flag would then mean "no human has looked", not "pages are
      // still missing" — which is a worklist item nobody can action and, for
      // any reader-facing signal derived from it, a warning that never clears.
      await this.flags.resolveSystem(
        data.organizationId,
        data.documentId,
        DocumentFlagType.PAGES_NOT_INDEXED,
      );
      return;
    }

    // **Through the shared policy, not a bare `create`** — `DocumentFlagWriter`
    // excludes documents that already have this flag open AND those where a
    // human resolved one. Both matter here and neither is hypothetical: BullMQ
    // retries this job, and the flag is written before the steps that can still
    // fail, so a bare insert puts the same finding on the worklist twice for
    // one document. And a Knowledge Manager who confirmed the appendix really
    // is a photograph would have that dismissal overturned by the next
    // re-ingestion — which is precisely what that service's docblock argues
    // destroys trust in the worklist.
    await this.flags.raise(
      data.organizationId,
      [data.documentId],
      DocumentFlagType.PAGES_NOT_INDEXED,
      // **WARNING, not the INFO default.** A Knowledge Manager scanning the
      // worklist should see "part of this document is not searchable" above the
      // `UNRETRIEVED` noise, and a one-word omission is what would bury it.
      DocumentFlagSeverity.WARNING,
      // **Page numbers and counts, never document text.** `detail` is
      // `@db.Text` and operator-facing, which puts it under the same rule as
      // `error_log` — and it is the field most likely to grow a helpful excerpt
      // later. "page 7 read as: …" is exactly the improvement somebody ships
      // without noticing they have put tenant content on an operator's screen.
      `${missing.length} of ${parsed.pageCount} page(s) could not be indexed: ` +
        `${summarizePages(missing)}. ${explainMissingPages(missing, parsed)}`,
    );

    this.logger.warn(
      `Document ${data.documentId}: ${missing.length}/${parsed.pageCount} pages not indexed`,
    );

    // **The mixed document needs the error line MORE than the refused one.** A
    // fully scanned upload fails loudly and someone comes looking; this one
    // reports INDEXED, and the only other trace of the server fault is a flag
    // on a tenant's worklist that no operator reads. `warn` above is about the
    // pages; this is about the deployment.
    const unavailable = parsed.failedPages.filter(
      (page) => page.reason === 'binary_missing',
    );
    if (unavailable.length > 0) {
      this.logger.error(
        `Document ${data.documentId}: OCR is unavailable on this deployment; ` +
          `${unavailable.length} page(s) could not be read`,
      );
    }
  }

  /**
   * The chunk rows, carrying the four scope columns copied from the parent.
   *
   * A chunk with a NULL `organization_id` is a chunk no tenant filter excludes
   * — the lexical arm's half of the boundary is these four columns, so writing
   * them is not bookkeeping, it is the security precondition.
   *
   * `deleteMany` first makes a re-run idempotent: a retried job that appended
   * would double every chunk. The matching Qdrant purge is the caller's, one
   * statement above.
   */
  private async writeChunkRows(
    documentId: string,
    chunks: Array<{
      chunkIndex: number;
      contentText: string;
      pageNumber: number | null;
      tokenCount: number;
    }>,
  ) {
    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { departmentLinks: { select: { departmentId: true } } },
    });

    const departmentIds = document.departmentLinks.map(
      (link) => link.departmentId,
    );

    await this.prisma.$transaction([
      this.prisma.documentChunk.deleteMany({ where: { documentId } }),
      this.prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId,
          chunkIndex: chunk.chunkIndex,
          contentText: chunk.contentText,
          pageNumber: chunk.pageNumber,
          tokenCount: chunk.tokenCount,
          organizationId: document.organizationId,
          isOrganizationWide: document.isOrganizationWide,
          departmentIds,
          isDeleted: document.deletedAt !== null,
        })),
      }),
    ]);

    return {
      organizationId: document.organizationId,
      isOrganizationWide: document.isOrganizationWide,
      departmentIds,
      isDeleted: document.deletedAt !== null,
    };
  }

  /**
   * Embed in batches, upsert, then write `vector_point_id` back.
   *
   * The gate is checked ONCE per batch rather than once per document, so a
   * tenant who crosses the cap halfway through a large document stops there
   * with half its chunks indexed.
   *
   * `vector_point_id` is nullable so that, WITHIN a run, a chunk without one is
   * a chunk whose upsert never happened — which is what keeps Postgres from
   * claiming vectors that are not there. It does not carry work across runs.
   */
  private async embedAndUpsert(
    data: IngestionJobData,
    scope: {
      organizationId: string;
      isOrganizationWide: boolean;
      departmentIds: string[];
      isDeleted: boolean;
    },
  ): Promise<void> {
    const settings = await this.aiSettings.settingsFor(data.organizationId);

    // Reads as "resume the chunks not yet embedded" and never does: every entry
    // into `process()` runs `writeChunkRows` first, which deletes and recreates
    // every row, so this matches the whole document on every run and the tenant
    // is billed for the repeat (known-gaps #11 — NOT #3, which is a deferred
    // job never being re-enqueued at all).
    const pending = await this.prisma.documentChunk.findMany({
      where: { documentId: data.documentId, vectorPointId: null },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, contentText: true },
    });

    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE);

      const decision = await this.ledger.checkBudget(
        data.organizationId,
        AiSurface.INGESTION_EMBEDDING,
        systemContext(data.organizationId),
      );
      if (!decision.allowed) throw new BudgetExhausted();

      const startedAt = Date.now();
      const result = await this.embeddings.embedBatch(
        batch.map((chunk) => chunk.contentText),
        settings.embeddingModel,
      );

      // CHARGE first, awaited. One INCRBY, and the only thing standing between
      // a burst of concurrent jobs and all of them passing a stale gate.
      const costMicros = estimateCostMicros(
        settings.embeddingModel,
        result.promptTokens,
        0,
      );
      await this.ledger.charge(
        data.organizationId,
        costMicros,
        systemContext(data.organizationId),
      );

      // RECORD second, fire-and-forget. The embedding already happened and
      // already cost money; failing the job because bookkeeping failed loses
      // the work AND the money.
      this.ledger.record({
        organizationId: data.organizationId,
        purpose: AiGenerationPurpose.EMBEDDING,
        modelName: settings.embeddingModel,
        promptTokens: result.promptTokens,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: AiGenerationStatus.SUCCESS,
      });

      const points: ChunkPoint[] = batch.map((chunk, index) => ({
        vectorPointId: randomUUID(),
        vector: result.vectors[index],
        chunkId: chunk.id,
        documentId: data.documentId,
        ...scope,
      }));

      // UPSERT, then write back. Never the reverse: a failed upsert after a
      // successful write-back leaves Postgres claiming vectors that do not
      // exist, and no query anywhere can detect it.
      for (
        let offset = 0;
        offset < points.length;
        offset += QDRANT_UPSERT_BATCH
      ) {
        await this.qdrant.upsertChunks(
          points.slice(offset, offset + QDRANT_UPSERT_BATCH),
        );
      }

      await this.prisma.$transaction(
        points.map((point) =>
          this.prisma.documentChunk.update({
            where: { id: point.chunkId },
            data: { vectorPointId: point.vectorPointId },
          }),
        ),
      );
    }
  }

  private async complete(
    data: IngestionJobData,
    chunkCount: number,
  ): Promise<void> {
    const [, document] = await this.prisma.$transaction([
      this.prisma.ingestionJob.update({
        where: { id: data.ingestionJobId },
        data: {
          status: IngestionJobStatus.COMPLETED,
          processedAt: new Date(),
          errorLog: null,
        },
      }),
      this.prisma.document.update({
        where: { id: data.documentId },
        data: { status: DocumentStatus.INDEXED },
        // The uploader, the title and the SCOPE. Taken from the
        // row this write already returns rather than fetched afterwards: the
        // relay decides which rooms the announcement reaches, and a
        // department-scoped document announced tenant-wide would disclose its
        // existence and title to exactly the people the department boundary
        // excludes. Carrying it on the event means there is no code path where
        // the lookup failed and the fan-out happened anyway.
        include: { departmentLinks: { select: { departmentId: true } } },
      }),
    ]);

    this.events.publish({
      pattern: DOCUMENT_PATTERNS.indexed,
      organizationId: data.organizationId,
      documentId: data.documentId,
      occurredAt: new Date().toISOString(),
      chunkCount,
      uploaderId: document.createdById,
      title: document.title,
      isOrganizationWide: document.isOrganizationWide,
      departmentIds: document.departmentLinks.map((link) => link.departmentId),
    });
  }

  /**
   * Records the failure where a human will find it.
   *
   * `error_log` on the job row rather than only in the service log: the point
   * of RDM Table 20 is that a stuck document is locatable by someone looking at
   * the document, not by someone who knows to grep a container's stdout.
   */
  private async fail(data: IngestionJobData, error: unknown): Promise<void> {
    const message = formatErrorMsg(error);
    // Read BEFORE the status writes, and separately from them: the failure
    // event must go out even if the writes below throw, and reading it there
    // would tie the notification to the bookkeeping succeeding.
    const document = await this.prisma.document.findUnique({
      where: { id: data.documentId },
      select: { createdById: true, title: true },
    });

    try {
      await this.prisma.$transaction([
        this.prisma.ingestionJob.update({
          where: { id: data.ingestionJobId },
          data: {
            status: IngestionJobStatus.FAILED,
            errorLog: message,
            processedAt: new Date(),
          },
        }),
        this.prisma.document.update({
          where: { id: data.documentId },
          data: { status: DocumentStatus.FAILED },
        }),
      ]);
    } catch (writeError) {
      // The original error is what matters and it is already being rethrown by
      // the caller. Swallowing this one keeps a failed status write from
      // replacing the real cause with a Prisma message.
      this.logger.error(
        `Could not record ingestion failure for ${data.documentId}: ${formatErrorMsg(writeError)}`,
      );
    }

    if (!document) {
      // No row, so no uploader, so nobody to tell. Publishing with an empty
      // recipient would put a `user:` room name of `user:` on the wire —
      // reaching nobody at best, and everybody if a future change ever treated
      // an empty id as a wildcard.
      this.logger.error(
        `Ingestion failed for a document that no longer exists: ${data.documentId}`,
      );
      return;
    }

    this.events.publish({
      pattern: DOCUMENT_PATTERNS.ingestionFailed,
      organizationId: data.organizationId,
      documentId: data.documentId,
      occurredAt: new Date().toISOString(),
      reason: message,
      // The uploader is the ONLY recipient. A failure is one
      // person's document not working, not department news.
      uploaderId: document.createdById,
      title: document.title,
    });
  }

  /**
   * Moves the job and its document to the phase they represent TOGETHER.
   *
   * One transaction, because the two rows are one fact stated twice and an
   * observer must never catch them disagreeing. Written separately, there is a
   * window where the job says `PARSING` and the document still says `PENDING` —
   * which is the exact state RDM Table 20 exists to make impossible, a document
   * that looks untouched while its job is mid-flight. The window is normally a
   * round-trip wide; on a crash between the two writes it is permanent, and
   * only the reconciliation sweep would ever untangle it.
   *
   * A refusal from {@link setJobStatus} rolls the document write back with it,
   * so a job that is no longer runnable cannot leave a document claiming to be
   * processing.
   */
  private async setPhase(
    ingestionJobId: string,
    jobStatus: IngestionJobStatus,
    documentId: string,
    documentStatus: DocumentStatus,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.setJobStatus(ingestionJobId, jobStatus, tx);
      await tx.document.update({
        where: { id: documentId },
        data: { status: documentStatus },
      });
    });
  }

  /**
   * @param client The transaction to run in. Defaults to the unwrapped client
   *   for the phases that move the job alone — CHUNKING and EMBEDDING leave the
   *   document at PROCESSING throughout.
   */
  private async setJobStatus(
    ingestionJobId: string,
    status: IngestionJobStatus,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const { count } = await client.ingestionJob.updateMany({
      // `notIn`, not `in RESUMABLE_*`: a FAILED row is what BullMQ retries, and
      // refusing it would make a transient outage permanent. Spread because the
      // constant is `as const`.
      where: {
        id: ingestionJobId,
        status: { notIn: [...TERMINAL_INGESTION_STATUSES] },
      },
      data: { status },
    });

    if (count === 0) throw new JobNoLongerRunnableError(ingestionJobId);
  }
}

/**
 * The sentence a Knowledge Manager reads under a `PAGES_NOT_INDEXED` flag.
 *
 * **Partitions `missing`, never labels it.** Pages go missing for three reasons
 * and `failedPages` explains only two of them — a page that OCR'd successfully
 * into eight tokens is `ok: true`, never enters that list, and vanishes at the
 * chunker's `MIN_CHUNK_TOKENS`. So a page in `missing` and absent from
 * `failedPages` falls to the third cause by elimination.
 *
 * Partitioning is also what stops ONE `binary_missing` page from relabelling a
 * document whose other gaps have nothing to do with the deployment: each cause
 * speaks only for the pages that are actually its own.
 *
 * @param missing every page number with no surviving chunk.
 * @param parsed the parse result, for `failedPages` and its reasons.
 */
function explainMissingPages(
  missing: number[],
  parsed: ParsedDocument,
): string {
  const reasons = new Map(
    parsed.failedPages.map((page) => [page.pageNumber, page.reason]),
  );

  const unavailable = missing.filter(
    (page) => reasons.get(page) === 'binary_missing',
  );
  const capped = missing.filter((page) => reasons.get(page) === 'page_cap');
  // By elimination, and that sweeps up the three OCR failures that ARE the
  // file's own problem — `timeout`, `engine_error` and `no_text` all mean OCR
  // ran and got nothing usable, which is the same advice as the thin-chunk
  // case. Keyed on the reason rather than on membership of the two arrays
  // above, which would be quadratic in the page count.
  const unreadable = missing.filter((page) => {
    const reason = reasons.get(page);

    return reason !== 'binary_missing' && reason !== 'page_cap';
  });

  const parts: string[] = [];
  if (unavailable.length > 0) {
    parts.push(
      `${summarizePages(unavailable)}: OCR is not available on this ` +
        'deployment, so scanned pages cannot be read — this is a server ' +
        'configuration problem and re-uploading will not change it.',
    );
  }
  if (capped.length > 0) {
    parts.push(
      `${summarizePages(capped)}: this document exceeds the ` +
        `${MAX_OCR_PAGES}-page OCR limit, so pages past it were not read. ` +
        'Split it into smaller documents.',
    );
  }
  if (unreadable.length > 0) {
    parts.push(
      `${summarizePages(unreadable)}: scanned pages are read with OCR and ` +
        'these produced no usable text; if this document is not in English, ' +
        're-upload it specifying its language.',
    );
  }

  return parts.join(' ');
}

/**
 * `[1, 2, 3, 7, 9, 10]` -> `"1-3, 7, 9-10"`.
 *
 * Ranges rather than a list because the common shape is contiguous — a
 * scanned appendix, a fax inserted mid-document — and "pages 40-83 could not be
 * indexed" is a sentence a Knowledge Manager can act on, while forty-four
 * comma-separated numbers is one they will scroll past.
 */
function summarizePages(pages: number[]): string {
  const ranges: string[] = [];
  let start = pages[0];
  let previous = pages[0];

  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }

    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = page;
    previous = page;
  }

  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);

  return ranges.join(', ');
}

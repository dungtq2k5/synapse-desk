import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AiGenerationPurpose,
  AiGenerationStatus,
  AiSurface,
  DOCUMENT_PATTERNS,
  DocumentStatus,
  EMBEDDING_BATCH_SIZE,
  estimateCostMicros,
  formatErrorMsg,
  IngestionJobStatus,
  QDRANT_UPSERT_BATCH,
  systemContext,
} from '@synapsedesk/common';
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
import { DocumentParserService } from './document-parser.service';
import { DocumentChunkerService } from './document-chunker.service';

export type IngestionJobData = {
  organizationId: string;
  documentId: string;
  ingestionJobId: string;
  objectPath: string;
  fileType: string;
};

/** Raised when the tenant is out of AI budget. Not a failure — a deferral. */
class BudgetExhausted extends Error {}

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
  async process(data: IngestionJobData): Promise<'INDEXED' | 'DEFERRED'> {
    const { documentId, ingestionJobId, organizationId } = data;

    try {
      await this.setJobStatus(ingestionJobId, IngestionJobStatus.PARSING);
      await this.setDocumentStatus(documentId, DocumentStatus.PROCESSING);

      const bytes = await this.storage.downloadObject(
        data.objectPath,
        organizationId,
      );
      const parsed = await this.parser.parse(bytes, data.fileType);

      await this.setJobStatus(ingestionJobId, IngestionJobStatus.CHUNKING);
      const chunks = this.chunker.chunk(parsed.pages);

      if (chunks.length === 0) {
        // Not an error. A cover sheet, a scanned image with no text layer, or
        // a near-empty file all land here, and `INDEXED` with zero chunks is
        // the truthful state — the document is processed and retrieves
        // nothing. FAILED would send someone hunting for a bug.
        this.logger.warn(`Document ${documentId} produced no chunks`);
        await this.complete(data, 0);
        return 'INDEXED';
      }

      // Written BEFORE the budget gate on purpose: parsing and chunking cost
      // nothing but CPU, and a tenant at the cap who later gets more budget
      // should resume at the embedding step rather than re-parse a 200-page
      // PDF. This is the same reasoning that keeps the job QUEUED.
      const scope = await this.writeChunkRows(documentId, chunks);

      await this.setJobStatus(ingestionJobId, IngestionJobStatus.EMBEDDING);
      await this.embedAndUpsert(data, scope);

      await this.complete(data, chunks.length);
      return 'INDEXED';
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        // Back to QUEUED, and the document back to PENDING. Both are honest:
        // nothing is wrong, the work is simply waiting for the cycle to roll.
        await this.setJobStatus(ingestionJobId, IngestionJobStatus.QUEUED);
        await this.setDocumentStatus(documentId, DocumentStatus.PENDING);
        this.logger.log(
          `Deferred ingestion of ${documentId}: organization ${organizationId} is at the AI cap`,
        );
        return 'DEFERRED';
      }

      await this.fail(data, error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * The chunk rows, carrying the four scope columns copied from the parent.
   *
   * A chunk with a NULL `organization_id` is a chunk no tenant filter excludes
   * — the lexical arm's half of the boundary is these four columns, so writing
   * them is not bookkeeping, it is the security precondition (11-doc §1.4).
   *
   * `deleteMany` first makes a re-run idempotent. A retried job that appended
   * would double every chunk and, worse, leave the first set orphaned in
   * Qdrant with no row pointing at them.
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
   * with half its chunks indexed — and the rows already written keep their
   * vectors. Re-running picks up exactly the chunks that still have no
   * `vector_point_id`, which is why that column being nullable is a feature.
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
    await this.prisma.$transaction([
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
      }),
    ]);

    this.events.publish({
      pattern: DOCUMENT_PATTERNS.indexed,
      organizationId: data.organizationId,
      documentId: data.documentId,
      occurredAt: new Date().toISOString(),
      chunkCount,
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

    this.events.publish({
      pattern: DOCUMENT_PATTERNS.ingestionFailed,
      organizationId: data.organizationId,
      documentId: data.documentId,
      occurredAt: new Date().toISOString(),
      reason: message,
    });
  }

  private async setJobStatus(
    ingestionJobId: string,
    status: IngestionJobStatus,
  ): Promise<void> {
    await this.prisma.ingestionJob.update({
      where: { id: ingestionJobId },
      data: { status },
    });
  }

  private async setDocumentStatus(
    documentId: string,
    status: DocumentStatus,
  ): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status },
    });
  }
}

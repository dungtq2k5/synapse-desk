import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentFlagType,
  DocumentFlagSeverity,
  DocumentStatus,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How many retrievals a document needs before `UNCITED` means anything.
 *
 * Below this, "retrieved but never cited" is indistinguishable from "barely
 * retrieved", and flagging it would send a Knowledge Manager to fix a document
 * the retriever has hardly seen.
 */
const UNCITED_MIN_RETRIEVALS = 20;

/**
 * Corpus quality flags — §4.2.
 *
 * **`UNRETRIEVED` and `UNCITED` were previously one flag under a name that fit
 * only one of them**, and the distinction is the whole value:
 *
 * | Flag | Condition | What it means |
 * | --- | --- | --- |
 * | `UNRETRIEVED` | `retrieval_count = 0` | Nobody's question ever came near it. Mis-titled, or genuinely unwanted |
 * | `UNCITED` | retrieved often, cited never | **The interesting one.** The retriever keeps selecting it and the generator keeps declining to use it — it is occupying a context slot a useful document would hold. *Polluting* context, which is worse than being ignored |
 *
 * These read the counters the §4.1 projection writes, never `ai_generations`
 * directly. A flag defined against the ledger stops working the moment
 * retention rolls it up — silently, reporting zero findings, which reads
 * exactly like a healthy corpus.
 */
@Injectable()
export class DocumentFlagService {
  private readonly logger = new Logger(DocumentFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  async detect(organizationId: string): Promise<number> {
    const [unretrieved, uncited] = await Promise.all([
      this.detectUnretrieved(organizationId),
      this.detectUncited(organizationId),
    ]);

    return unretrieved + uncited;
  }

  /**
   * Documents whose every chunk has never been retrieved.
   *
   * `every`, not `some`: a document with one dead chunk and forty live ones is
   * a normal document. Flagging on any single unretrieved chunk would flag
   * essentially the whole corpus, and a flag that fires on everything is a
   * flag nobody reads.
   */
  private async detectUnretrieved(organizationId: string): Promise<number> {
    const candidates = await this.prisma.document.findMany({
      where: {
        organizationId,
        deletedAt: null,
        // INDEXED only. A document still processing has no chunks to retrieve,
        // so flagging it would report a pipeline state as a quality problem.
        status: DocumentStatus.INDEXED,
        chunks: { some: {} },
      },
      select: {
        id: true,
        chunks: { select: { retrievalCount: true, citationCount: true } },
      },
    });

    const flagged = candidates.filter((document) =>
      document.chunks.every((chunk) => chunk.retrievalCount === 0),
    );

    return this.raise(
      organizationId,
      flagged.map((document) => document.id),
      DocumentFlagType.UNRETRIEVED,
      DocumentFlagSeverity.INFO,
      'No question has ever retrieved this document. It may be mis-titled, or it may not be needed.',
    );
  }

  /**
   * Retrieved often, cited never — the flag that changes what someone does.
   *
   * Summed across the document rather than per chunk: a document earns its
   * context slot as a whole, and one chunk that happens to be cited is enough
   * to say the document is doing its job.
   */
  private async detectUncited(organizationId: string): Promise<number> {
    const candidates = await this.prisma.document.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: DocumentStatus.INDEXED,
        chunks: { some: {} },
      },
      select: {
        id: true,
        chunks: { select: { retrievalCount: true, citationCount: true } },
      },
    });

    const flagged = candidates.filter((document) => {
      const retrievals = document.chunks.reduce(
        (total, chunk) => total + chunk.retrievalCount,
        0,
      );
      const citations = document.chunks.reduce(
        (total, chunk) => total + chunk.citationCount,
        0,
      );

      return retrievals >= UNCITED_MIN_RETRIEVALS && citations === 0;
    });

    return this.raise(
      organizationId,
      flagged.map((document) => document.id),
      DocumentFlagType.UNCITED,
      // WARNING rather than INFO. This document is actively costing every
      // answer a context slot, which is worse than being ignored.
      DocumentFlagSeverity.WARNING,
      `This document has been retrieved at least ${UNCITED_MIN_RETRIEVALS} times and cited none. It may be crowding out more useful sources.`,
    );
  }

  /**
   * Raises flags that are not already open, and NEVER re-raises a resolved one.
   *
   * A human dismissing a flag is a decision, and a job that re-raised it on the
   * next run would be arguing with them once a day until they stopped reading
   * flags entirely. `resolvedAt IS NULL` in the exclusion set is what makes
   * dismissal stick.
   *
   * **Public because ingestion writes a flag too** — `PAGES_NOT_INDEXED`,
   * 34-doc §6 — and that one is not a sweep: it is raised at index time, and
   * BullMQ retries the job that raises it. Both consequences of writing flags
   * without this policy are the ones the paragraph above describes: a retry
   * duplicates the row, and a dismissed flag comes back.
   *
   * One implementation rather than a second copy, because the policy is an
   * argued decision about human behaviour and a copy is where the argument
   * gets lost — the next writer would follow whichever version they read first.
   */
  async raise(
    organizationId: string,
    documentIds: string[],
    flagType: DocumentFlagType,
    severity: DocumentFlagSeverity,
    detail: string,
  ): Promise<number> {
    if (documentIds.length === 0) return 0;

    const existing = await this.prisma.documentFlag.findMany({
      where: { organizationId, flagType, documentId: { in: documentIds } },
      select: { documentId: true, resolvedAt: true },
    });

    // Both open AND resolved flags are excluded, for different reasons: an
    // open one is already raised, and a resolved one was dismissed on purpose.
    const seen = new Set(existing.map((flag) => flag.documentId));
    const fresh = documentIds.filter((id) => !seen.has(id));

    if (fresh.length === 0) return 0;

    const result = await this.prisma.documentFlag.createMany({
      data: fresh.map((documentId) => ({
        organizationId,
        documentId,
        flagType,
        severity,
        detail,
      })),
    });

    this.logger.log(`Raised ${result.count} ${flagType} flag(s)`);

    return result.count;
  }

  /**
   * Marks a flag handled, recording WHO.
   *
   * `resolved_by_id` is what turns "this flag is closed" into "a person closed
   * this flag", which is the difference between a dismissal the job must
   * respect and a state it could reasonably re-derive.
   */
  async resolve(
    flagId: string,
    resolvedById: string,
    resolution: string,
  ): Promise<void> {
    await this.prisma.documentFlag.update({
      where: { id: flagId },
      data: { resolvedAt: new Date(), resolvedById, resolution },
    });
  }
}

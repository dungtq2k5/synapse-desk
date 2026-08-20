import { Injectable, Logger } from '@nestjs/common';
import {
  DISMISSAL_SUPPRESSION_DAYS,
  DocumentFlagResolution,
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

/** The oldest dismissal that still suppresses a re-raise. */
function dismissalCutoff(): Date {
  return new Date(
    Date.now() - DISMISSAL_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * The only class that CREATES flag rows.
 *
 * Named for that rather than for detection, because `raise()` is deliberately
 * public and its second caller detects nothing: `ingestion.processor` raises
 * `PAGES_NOT_INDEXED` at index time. Both methods are writes and both callers
 * are writers.
 *
 * Not to be confused with `DocumentFlagsService` in `modules/document-flags/`,
 * which is the REQUEST side — it takes `CallerContext`, enforces
 * `documentVisibility`, and never creates a row. The two were one letter apart
 * until this was renamed.
 *
 * Corpus quality flags.
 *
 * `UNRETRIEVED` and `UNCITED` are separate, and the distinction is the value:
 *
 * | Flag | Condition | What it means |
 * | --- | --- | --- |
 * | `UNRETRIEVED` | `retrieval_count = 0` | Nobody's question ever came near it. Mis-titled, or genuinely unwanted |
 * | `UNCITED` | retrieved often, cited never | **The interesting one.** The retriever keeps selecting it and the generator keeps declining to use it — occupying a context slot a useful document would hold |
 *
 * These read the counters the chunk-usage projection writes, never
 * `ai_generations` directly — see
 * `docs/decisions/0025-chunk-usage-is-a-projection.md`.
 */
@Injectable()
export class DocumentFlagWriter {
  private readonly logger = new Logger(DocumentFlagWriter.name);

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
   * Raises flags that are not already open, and honours a recent dismissal.
   *
   * A human dismissing a flag is a decision, and a job that re-raised it on the
   * next run would be arguing with them once a day until they stopped reading
   * flags entirely. So `DISMISSED` suppresses for
   * {@link DISMISSAL_SUPPRESSION_DAYS} — long enough that nobody is argued
   * with, bounded so one wrong click does not remove a document from a quality
   * signal for the life of the tenant.
   *
   * `FIXED` and `DOCUMENT_REPLACED` suppress NOTHING. They say the problem is
   * gone; a detector that finds it again is saying the fix did not work, which
   * is the one message that must not be swallowed.
   *
   * **Public because ingestion writes a flag too** — `PAGES_NOT_INDEXED`,
   * And that one is not a sweep: it is raised at index time, and
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

    // **The policy is IN the predicate, not applied to the result.** Reducing
    // in JS would return every historical row and then decide — and a document
    // whose only row is `FIXED` would still be filtered out, which is the bug
    // this replaces. Only suppressing rows come back, so the `Set` is correct
    // by construction and the `select` narrows to the one column it needs.
    const suppressed = await this.prisma.documentFlag.findMany({
      where: {
        organizationId,
        flagType,
        documentId: { in: documentIds },
        OR: [
          // Already raised.
          { resolvedAt: null },
          // Dismissed recently. FIXED and DOCUMENT_REPLACED are absent ON
          // PURPOSE: they assert the problem is GONE, so a detector that finds
          // it again is reporting news rather than arguing with anyone.
          {
            resolution: DocumentFlagResolution.DISMISSED,
            resolvedAt: { gte: dismissalCutoff() },
          },
        ],
      },
      select: { documentId: true },
    });

    const seen = new Set(suppressed.map((flag) => flag.documentId));
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
}

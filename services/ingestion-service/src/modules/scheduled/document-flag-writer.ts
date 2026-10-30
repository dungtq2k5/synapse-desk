import { Injectable, Logger } from '@nestjs/common';
import {
  DISMISSAL_SUPPRESSION_DAYS,
  DOCUMENT_REVIEW_DAYS,
  DocumentFlagResolution,
  DocumentFlagType,
  DocumentFlagSeverity,
  DocumentStatus,
  FEEDBACK_WINDOW_DAYS,
  INACCURATE_CITATION_MIN,
  LOW_CITATION_RATE,
  NEGATIVE_FEEDBACK_MIN_DOWNVOTES,
  UNCITED_MIN_RETRIEVALS,
} from '@synapsedesk/contracts';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import type { CitedDocumentFeedback } from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { TicketReferenceService } from '../ticket-client/ticket-reference.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment `days` ago. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** A date as a flag's sentence names it: "September 12, 2025". */
function longDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * One flag to raise: the document, the sentence a Knowledge Manager reads,
 * and, for `CONFLICTING`, the other side.
 */
export type FlagFinding = {
  documentId: string;
  detail: string;
  relatedDocumentId?: string;
  relatedChunkId?: string;
  confidenceScore?: number;
};

/** A document's live-version counters, summed over its chunks. */
type Counters = { documentId: string; retrievals: number; citations: number };

/** The suppression key: one flag per document, type and related document. */
const keyOf = (documentId: string, relatedDocumentId?: string | null) =>
  `${documentId}:${relatedDocumentId ?? ''}`;

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
 * | `LOW_CONFIDENCE` | retrieved often, cited in under 5% | The answers rarely trust it |
 * | `OUTDATED` | file unreviewed for a year | Someone should check it's still current |
 * | `NEGATIVE_FEEDBACK` | answers citing it rated down | Readers say the answers it feeds are wrong |
 *
 * The counter flags read the counters the chunk-usage projection writes, never
 * `ai_generations` directly — see
 * `docs/decisions/0025-chunk-usage-is-a-projection.md`. `NEGATIVE_FEEDBACK`
 * reads ticket-service, where the ratings are.
 */
@Injectable()
export class DocumentFlagWriter {
  private readonly logger = new Logger(DocumentFlagWriter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketReferenceService,
  ) {}

  /**
   * Every heuristic flag for one tenant.
   *
   * `NEGATIVE_FEEDBACK` reads ticket-service and is tried on its own: an
   * outage there skips that flag for the night and the others still run.
   */
  async detect(organizationId: string): Promise<number> {
    const counters = await this.liveCounters(organizationId);
    const [unretrieved, uncited, lowConfidence, outdated] = await Promise.all([
      this.detectUnretrieved(organizationId, counters),
      this.detectUncited(organizationId, counters),
      this.detectLowConfidence(organizationId, counters),
      this.detectOutdated(organizationId),
    ]);

    let negative = 0;
    try {
      negative = await this.detectNegativeFeedback(organizationId);
    } catch (error) {
      this.logger.warn(
        `Skipped NEGATIVE_FEEDBACK for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }

    return unretrieved + uncited + lowConfidence + outdated + negative;
  }

  /**
   * The live version's counters of every `INDEXED`, not-deleted document in
   * the tenant, summed per document.
   *
   * INDEXED only: a document still processing has no chunks to retrieve, so
   * flagging it would report a pipeline state as a quality problem. Live rows
   * only: an update's staged chunks start at 0.
   */
  private async liveCounters(organizationId: string): Promise<Counters[]> {
    const groups = await this.prisma.documentChunk.groupBy({
      by: ['documentId'],
      where: {
        isStaged: false,
        document: {
          organizationId,
          deletedAt: null,
          status: DocumentStatus.INDEXED,
        },
      },
      _sum: { retrievalCount: true, citationCount: true },
    });

    return groups.map((group) => ({
      documentId: group.documentId,
      retrievals: group._sum.retrievalCount ?? 0,
      citations: group._sum.citationCount ?? 0,
    }));
  }

  /**
   * Documents whose every chunk has never been retrieved.
   *
   * Every chunk, not some: a document with one dead chunk and forty live ones
   * is a normal document. Counters never go below 0, so "every chunk at 0" is
   * "the sum is 0".
   */
  private detectUnretrieved(
    organizationId: string,
    counters: Counters[],
  ): Promise<number> {
    return this.raise(
      organizationId,
      DocumentFlagType.UNRETRIEVED,
      DocumentFlagSeverity.INFO,
      counters
        .filter((document) => document.retrievals === 0)
        .map((document) => ({
          documentId: document.documentId,
          detail:
            'No question has ever retrieved this document. It may be mis-titled, or it may not be needed.',
        })),
    );
  }

  /**
   * Retrieved often, cited never — the flag that changes what someone does.
   *
   * Summed across the document rather than per chunk: a document earns its
   * context slot as a whole, and one chunk that happens to be cited is enough
   * to say the document is doing its job.
   */
  private detectUncited(
    organizationId: string,
    counters: Counters[],
  ): Promise<number> {
    return this.raise(
      organizationId,
      DocumentFlagType.UNCITED,
      // WARNING rather than INFO. This document is actively costing every
      // answer a context slot, which is worse than being ignored.
      DocumentFlagSeverity.WARNING,
      counters
        .filter(
          (document) =>
            document.retrievals >= UNCITED_MIN_RETRIEVALS &&
            document.citations === 0,
        )
        .map((document) => ({
          documentId: document.documentId,
          detail: `This document has been retrieved at least ${UNCITED_MIN_RETRIEVALS} times and cited none. It may be crowding out more useful sources.`,
        })),
    );
  }

  /**
   * Found often, rarely cited: cited at least once, but in fewer than
   * {@link LOW_CITATION_RATE} of its retrievals. Never with `UNCITED`, which
   * owns zero citations.
   */
  private detectLowConfidence(
    organizationId: string,
    counters: Counters[],
  ): Promise<number> {
    return this.raise(
      organizationId,
      DocumentFlagType.LOW_CONFIDENCE,
      DocumentFlagSeverity.WARNING,
      counters
        .filter(
          (document) =>
            // Implied today (one citation under 1 in 20 is over 20
            // retrievals); it binds if the rate is ever raised.
            document.retrievals >= UNCITED_MIN_RETRIEVALS &&
            document.citations >= 1 &&
            document.citations / document.retrievals < LOW_CITATION_RATE,
        )
        .map((document) => ({
          documentId: document.documentId,
          detail: `Cited in ${document.citations} of the ${document.retrievals} answers it was found for. The answers rarely trust it; check that it says what its title promises.`,
        })),
    );
  }

  /**
   * Files unreviewed for {@link DOCUMENT_REVIEW_DAYS}.
   *
   * Counted from the later of the file's date and the last time a PERSON
   * resolved an `OUTDATED` flag on it (Dismiss or Fixed: a resolution with an
   * actor). So dismissing means "reviewed, still current" for another year,
   * not the 30 days other types are quiet for. A replace moves the file's
   * date; a system resolution has no actor and moves nothing.
   */
  private async detectOutdated(organizationId: string): Promise<number> {
    const cutoff = daysAgo(DOCUMENT_REVIEW_DAYS);
    const candidates = await this.prisma.document.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: DocumentStatus.INDEXED,
        fileUpdatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        fileUpdatedAt: true,
        flags: {
          where: {
            flagType: DocumentFlagType.OUTDATED,
            resolvedById: { not: null },
            resolvedAt: { gte: cutoff },
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    return this.raise(
      organizationId,
      DocumentFlagType.OUTDATED,
      DocumentFlagSeverity.WARNING,
      candidates
        .filter((document) => document.flags.length === 0)
        .map((document) => ({
          documentId: document.id,
          detail: `Its file hasn’t changed since ${longDate(document.fileUpdatedAt)}. Check it’s still current; dismiss to mark it reviewed for another year.`,
        })),
    );
  }

  /**
   * Answers citing it are rated badly, in the last
   * {@link FEEDBACK_WINDOW_DAYS}: at least
   * {@link NEGATIVE_FEEDBACK_MIN_DOWNVOTES} thumbs-down that are at least half
   * its ratings, or at least {@link INACCURATE_CITATION_MIN} "citation
   * inaccurate" marks.
   *
   * The ratings live with the answers, in ticket-service, so they're read from
   * there; a replaced version's ratings still count against the document,
   * since a replace resolves the flag and the window ages them out.
   *
   * @throws when ticket-service can't answer; {@link detect} skips the flag.
   */
  private async detectNegativeFeedback(
    organizationId: string,
  ): Promise<number> {
    const feedback = await this.tickets.citedDocumentFeedback(
      organizationId,
      daysAgo(FEEDBACK_WINDOW_DAYS),
    );
    const ratedDown = (document: CitedDocumentFeedback) =>
      document.downvotes >= NEGATIVE_FEEDBACK_MIN_DOWNVOTES &&
      document.downvotes * 2 >= document.ratings;
    const markedInaccurate = (document: CitedDocumentFeedback) =>
      document.inaccurate >= INACCURATE_CITATION_MIN;
    const flagged = feedback.filter(
      (document) => ratedDown(document) || markedInaccurate(document),
    );
    if (flagged.length === 0) return 0;

    // ticket-service knows ids only; the flag goes on a document that still
    // answers.
    const live = await this.prisma.document.findMany({
      where: {
        id: { in: flagged.map((document) => document.documentId) },
        organizationId,
        deletedAt: null,
        status: DocumentStatus.INDEXED,
      },
      select: { id: true },
    });
    const liveIds = new Set(live.map((document) => document.id));

    return this.raise(
      organizationId,
      DocumentFlagType.NEGATIVE_FEEDBACK,
      DocumentFlagSeverity.WARNING,
      flagged
        .filter((document) => liveIds.has(document.documentId))
        .map((document) => ({
          documentId: document.documentId,
          detail: [
            ratedDown(document)
              ? `${document.downvotes} of ${document.ratings} ratings of answers citing it were thumbs-down in the last ${FEEDBACK_WINDOW_DAYS} days.`
              : null,
            markedInaccurate(document)
              ? `${document.inaccurate} said an answer citing it was inaccurate.`
              : null,
          ]
            .filter(Boolean)
            .join(' '),
        })),
    );
  }

  /**
   * Closes an open flag because the condition that raised it is gone.
   *
   * **A SYSTEM resolution.** `resolved_by_id` is nullable precisely so an
   * actor-less act is representable — the same shape `AuditPublisher`'s
   * `recordSystem` uses — and `FIXED` is the honest resolution: the problem was
   * real and no longer is.
   *
   * Conditional on `resolvedAt: null`, so it can never overwrite a human's
   * decision or its comment.
   *
   * **Resolved, never deleted.** `FIXED` suppresses nothing, so if the same
   * condition returns on a later run `raise()` raises it again — which is the
   * behaviour wanted, and the reason deleting the row would be wrong.
   *
   * @param relatedDocumentId for `CONFLICTING`, the pair's other document;
   *   absent, every open flag of the type on the document.
   * @returns how many flags were closed, which is 0 or 1 in practice.
   */
  async resolveSystem(
    organizationId: string,
    documentId: string,
    flagType: DocumentFlagType,
    relatedDocumentId?: string,
  ): Promise<number> {
    const { count } = await this.prisma.documentFlag.updateMany({
      where: {
        organizationId,
        documentId,
        flagType,
        resolvedAt: null,
        ...(relatedDocumentId ? { relatedDocumentId } : {}),
      },
      data: {
        resolvedAt: new Date(),
        resolution: DocumentFlagResolution.FIXED,
        // No actor: the pipeline closed this, not a person. Attributing it to
        // anyone would put a name in a worklist beside a decision they did not
        // make.
        resolvedById: null,
        resolutionComment:
          'Resolved automatically: the condition no longer holds',
      },
    });

    if (count > 0) {
      this.logger.log(
        `Resolved ${count} ${flagType} flag(s) for ${documentId}`,
      );
    }

    return count;
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
    flagType: DocumentFlagType,
    severity: DocumentFlagSeverity,
    findings: FlagFinding[],
  ): Promise<number> {
    if (findings.length === 0) return 0;

    // **The policy is IN the predicate, not applied to the result.** Reducing
    // in JS would return every historical row and then decide — and a document
    // whose only row is `FIXED` would still be filtered out, which is the bug
    // this replaces. Only suppressing rows come back, so the `Set` is correct
    // by construction.
    const suppressed = await this.prisma.documentFlag.findMany({
      where: {
        organizationId,
        flagType,
        documentId: { in: findings.map((finding) => finding.documentId) },
        OR: [
          // Already raised.
          { resolvedAt: null },
          // Dismissed recently. FIXED and DOCUMENT_REPLACED are absent ON
          // PURPOSE: they assert the problem is GONE, so a detector that finds
          // it again is reporting news rather than arguing with anyone.
          {
            resolution: DocumentFlagResolution.DISMISSED,
            resolvedAt: { gte: daysAgo(DISMISSAL_SUPPRESSION_DAYS) },
          },
        ],
      },
      select: { documentId: true, relatedDocumentId: true },
    });

    // Keyed by the related document too, so a document holds one
    // `CONFLICTING` flag per other document; every other type has none.
    const seen = new Set(
      suppressed.map((flag) => keyOf(flag.documentId, flag.relatedDocumentId)),
    );
    const fresh = findings.filter((finding) => {
      const key = keyOf(finding.documentId, finding.relatedDocumentId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (fresh.length === 0) return 0;

    const result = await this.prisma.documentFlag.createMany({
      data: fresh.map((finding) => ({
        organizationId,
        documentId: finding.documentId,
        flagType,
        severity,
        detail: finding.detail,
        relatedDocumentId: finding.relatedDocumentId ?? null,
        relatedChunkId: finding.relatedChunkId ?? null,
        confidenceScore: finding.confidenceScore ?? null,
      })),
    });

    this.logger.log(`Raised ${result.count} ${flagType} flag(s)`);

    return result.count;
  }
}

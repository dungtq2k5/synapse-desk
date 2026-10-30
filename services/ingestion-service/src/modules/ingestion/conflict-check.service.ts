import { Injectable, Logger } from '@nestjs/common';
import {
  AiSurface,
  CONFLICT_CONFIDENCE_MIN,
  CONFLICT_PAIRS_PER_DOCUMENT,
  CONFLICT_SIMILARITY_MIN,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
  systemContext,
} from '@synapsedesk/contracts';
import type { JudgeConflictResponse } from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { AiLedgerService } from '../ai-ledger/ai-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { RagReferenceService } from '../rag-client/rag-reference.service';
import {
  DocumentFlagWriter,
  FlagFinding,
} from '../scheduled/document-flag-writer';

/** Who can read a document: its scope, as visibility decides it. */
type Audience = {
  isOrganizationWide: boolean;
  departmentIds: string[];
  deleted: boolean;
};

/**
 * Whether a flag on `flagged` may name `named`: everyone who can read the
 * flagged document can read the named one too.
 *
 * The flag's detail quotes the named document and "Open both" links to it,
 * so a flag readable by someone who can't open the other side would disclose
 * it. Named is organization-wide, or flagged is department-scoped and named
 * reaches every one of its departments. A deleted document is never named, and
 * never flagged.
 *
 * @example
 * // The org-wide handbook and HR's policy: raised on HR's policy only.
 * mayName(hrPolicy, handbook) // true
 * mayName(handbook, hrPolicy) // false
 */
export function mayName(flagged: Audience, named: Audience): boolean {
  if (flagged.deleted || named.deleted) return false;
  if (named.isOrganizationWide) return true;
  if (flagged.isOrganizationWide) return false;

  const reached = new Set(named.departmentIds);
  return flagged.departmentIds.every((id) => reached.has(id));
}

/** A judged pair that conflicts: the other document and the two passages. */
type Conflict = {
  otherId: string;
  chunkId: string;
  otherChunkId: string;
  confidence: number;
  detail: string;
};

/**
 * The `CONFLICTING` detector: one document's live passages against the
 * nearest passages of every other document in the tenant.
 *
 * **A check either completes or changes nothing.** It completes when every
 * pair it chose has a verdict: then `conflicts_checked_at` is set, the pairs
 * judged conflicting are raised (on each side its readers may see, B3), and
 * every open `CONFLICTING` flag between this document and another that isn't
 * in the new set is resolved. Stopped at the AI cap or by a judge failure, it
 * resolves nothing, raises nothing and leaves the document unchecked for the
 * nightly sweep.
 */
@Injectable()
export class ConflictCheckService {
  private readonly logger = new Logger(ConflictCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrant: QdrantService,
    private readonly ledger: AiLedgerService,
    private readonly rag: RagReferenceService,
    private readonly flags: DocumentFlagWriter,
  ) {}

  /**
   * Checks one document.
   *
   * @returns whether the check completed.
   */
  async check(documentId: string): Promise<boolean> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        status: DocumentStatus.INDEXED,
      },
      include: { departmentLinks: { select: { departmentId: true } } },
    });
    if (!document) return false;
    const organizationId = document.organizationId;

    const conflicts = await this.judgePairs(
      organizationId,
      documentId,
      document.title,
    );
    if (!conflicts) return false;

    await this.prisma.document.update({
      where: { id: documentId },
      data: { conflictsCheckedAt: new Date() },
    });

    const others = await this.prisma.document.findMany({
      where: { id: { in: conflicts.map((conflict) => conflict.otherId) } },
      include: { departmentLinks: { select: { departmentId: true } } },
    });
    const audiences = new Map(
      others.map((other) => [other.id, audienceOf(other)]),
    );
    const own = audienceOf(document);

    const onThis: FlagFinding[] = [];
    const onOthers: FlagFinding[] = [];
    let unraisable = 0;
    for (const conflict of conflicts) {
      const other = audiences.get(conflict.otherId);
      if (!other) continue;
      if (!mayName(own, other) && !mayName(other, own)) unraisable += 1;
      if (mayName(own, other)) {
        onThis.push({
          documentId,
          relatedDocumentId: conflict.otherId,
          relatedChunkId: conflict.chunkId,
          confidenceScore: conflict.confidence,
          detail: conflict.detail,
        });
      }
      if (mayName(other, own)) {
        onOthers.push({
          documentId: conflict.otherId,
          relatedDocumentId: documentId,
          relatedChunkId: conflict.otherChunkId,
          confidenceScore: conflict.confidence,
          detail: conflict.detail,
        });
      }
    }

    if (unraisable > 0) {
      this.logger.log(
        `${unraisable} conflict(s) for ${documentId} raised on neither side: no side's readers can open the other`,
      );
    }

    await this.flags.raise(
      organizationId,
      DocumentFlagType.CONFLICTING,
      DocumentFlagSeverity.CRITICAL,
      [...onThis, ...onOthers],
    );
    await this.resolveGone(
      organizationId,
      documentId,
      new Set(onThis.map((finding) => finding.relatedDocumentId as string)),
      new Set(onOthers.map((finding) => finding.documentId)),
    );

    return true;
  }

  /**
   * Resolves every open `CONFLICTING` flag between this document and another
   * whose pair the check didn't confirm: on this document naming another not
   * in `onThis`, and on another naming this one not in `onOthers`.
   */
  private async resolveGone(
    organizationId: string,
    documentId: string,
    onThis: Set<string>,
    onOthers: Set<string>,
  ): Promise<void> {
    const open = await this.prisma.documentFlag.findMany({
      where: {
        organizationId,
        flagType: DocumentFlagType.CONFLICTING,
        resolvedAt: null,
        OR: [{ documentId }, { relatedDocumentId: documentId }],
      },
      select: { documentId: true, relatedDocumentId: true },
    });

    for (const flag of open) {
      const stale =
        flag.documentId === documentId
          ? !flag.relatedDocumentId || !onThis.has(flag.relatedDocumentId)
          : !onOthers.has(flag.documentId);
      if (stale) {
        await this.flags.resolveSystem(
          organizationId,
          flag.documentId,
          DocumentFlagType.CONFLICTING,
          flag.relatedDocumentId ?? undefined,
        );
      }
    }
  }

  /**
   * The most similar pairs, judged.
   *
   * For each live passage, its nearest live passages in other documents at
   * or above {@link CONFLICT_SIMILARITY_MIN}; the top
   * {@link CONFLICT_PAIRS_PER_DOCUMENT} pairs overall go to the judge. One
   * conflict per other document, the most confident.
   *
   * @returns the conflicts, or `null` when the check stopped: at the AI cap
   *   or on a judge failure.
   */
  private async judgePairs(
    organizationId: string,
    documentId: string,
    title: string,
  ): Promise<Conflict[] | null> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId, isStaged: false, vectorPointId: { not: null } },
      select: { id: true, vectorPointId: true, contentText: true },
    });

    const pairs: {
      chunkId: string;
      otherChunkId: string;
      otherId: string;
      score: number;
    }[] = [];
    for (const chunk of chunks) {
      const nearest = await this.qdrant.nearestInOtherDocuments(
        chunk.vectorPointId as string,
        documentId,
        organizationId,
        CONFLICT_PAIRS_PER_DOCUMENT,
        CONFLICT_SIMILARITY_MIN,
      );
      for (const hit of nearest) {
        pairs.push({
          chunkId: chunk.id,
          otherChunkId: hit.chunkId,
          otherId: hit.documentId,
          score: hit.score,
        });
      }
    }
    const chosen = pairs
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFLICT_PAIRS_PER_DOCUMENT);
    if (chosen.length === 0) return [];

    const texts = new Map(chunks.map((chunk) => [chunk.id, chunk.contentText]));
    const otherChunks = await this.prisma.documentChunk.findMany({
      where: {
        id: { in: chosen.map((pair) => pair.otherChunkId) },
        isStaged: false,
      },
      select: {
        id: true,
        contentText: true,
        document: { select: { title: true } },
      },
    });
    const others = new Map(otherChunks.map((chunk) => [chunk.id, chunk]));

    const best = new Map<string, Conflict>();
    for (const pair of chosen) {
      const other = others.get(pair.otherChunkId);
      if (!other) continue;

      const decision = await this.ledger.checkBudget(
        organizationId,
        AiSurface.DOCUMENT_CONFLICT_CHECK,
        systemContext(organizationId),
      );
      if (!decision.allowed) {
        this.logger.log(
          `Conflict check of ${documentId} stopped: the organization is at the AI cap`,
        );
        return null;
      }

      let verdict: JudgeConflictResponse;
      try {
        verdict = await this.rag.judgeConflict(
          organizationId,
          { documentTitle: title, text: texts.get(pair.chunkId) ?? '' },
          { documentTitle: other.document.title, text: other.contentText },
        );
      } catch (error) {
        this.logger.warn(
          `Conflict check of ${documentId} stopped: ${formatErrorMsg(error)}`,
        );
        return null;
      }

      if (
        !verdict.conflicting ||
        verdict.confidence < CONFLICT_CONFIDENCE_MIN
      ) {
        continue;
      }
      const current = best.get(pair.otherId);
      if (!current || verdict.confidence > current.confidence) {
        best.set(pair.otherId, {
          otherId: pair.otherId,
          chunkId: pair.chunkId,
          otherChunkId: pair.otherChunkId,
          confidence: verdict.confidence,
          detail: verdict.detail,
        });
      }
    }

    return [...best.values()];
  }

  /**
   * B3 again, after a visibility change to one document (a delete included):
   * every `CONFLICTING` flag on it or naming it, open or resolved, whose
   * flagged side's readers can no longer open the named side loses the named
   * side's words and ids, and an open one is resolved
   * ({@link DocumentFlagWriter.redactConflict}).
   *
   * Resolved flags too, because "include resolved" shows them to the same
   * readers. A restore needs nothing: it can't disclose, and the next check
   * finds the pair again.
   *
   * @returns how many flags lost the other document.
   */
  async retestAudience(documentId: string): Promise<number> {
    const named = await this.prisma.documentFlag.findMany({
      where: {
        flagType: DocumentFlagType.CONFLICTING,
        relatedDocumentId: { not: null },
        OR: [{ documentId }, { relatedDocumentId: documentId }],
      },
      select: {
        id: true,
        document: {
          include: { departmentLinks: { select: { departmentId: true } } },
        },
        relatedDocument: {
          include: { departmentLinks: { select: { departmentId: true } } },
        },
      },
    });

    let redacted = 0;
    for (const flag of named) {
      const allowed =
        flag.relatedDocument !== null &&
        mayName(audienceOf(flag.document), audienceOf(flag.relatedDocument));
      if (allowed) continue;

      await this.flags.redactConflict(flag.id);
      redacted += 1;
    }

    return redacted;
  }
}

function audienceOf(document: {
  isOrganizationWide: boolean;
  deletedAt: Date | null;
  departmentLinks: { departmentId: string }[];
}): Audience {
  return {
    isOrganizationWide: document.isOrganizationWide,
    departmentIds: document.departmentLinks.map((link) => link.departmentId),
    deleted: document.deletedAt !== null,
  };
}

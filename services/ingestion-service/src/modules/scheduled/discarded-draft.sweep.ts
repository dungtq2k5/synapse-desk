import { Injectable, Logger } from '@nestjs/common';
import { AiGenerationOutcome, AiGenerationPurpose } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long a draft may sit unreferenced before it counts as discarded.
 *
 * **The race this interval exists to avoid:** an agent opens a draft, gets
 * pulled into something else, and posts it hours later. A short window would
 * mark that draft DISCARDED and then the post would set it ACCEPTED — two
 * writes disagreeing about the same row, with whichever ran last winning.
 */
const DISCARD_AFTER_HOURS = 24;

/**
 * `outcome = DISCARDED` is an ABSENCE.
 *
 * Ignoring a draft produces no request, so nothing ever sets it. Without this
 * sweep those rows stay NULL forever and acceptance rate divides by only the
 * drafts that were USED — reporting a number near 100% no matter how bad the
 * drafts are, which is worse than reporting nothing at all.
 */
@Injectable()
export class DiscardedDraftSweep {
  private readonly logger = new Logger(DiscardedDraftSweep.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DISCARD_AFTER_HOURS * 3_600_000);

    const result = await this.prisma.aiGeneration.updateMany({
      where: {
        purpose: AiGenerationPurpose.DRAFT,
        // BOTH null checks, not just `outcome`. A row with a
        // `resulting_message_id` but no outcome is a partially-written
        // acceptance, and sweeping it to DISCARDED would erase the very event
        // the metric is trying to count.
        outcome: null,
        resultingMessageId: null,
        createdAt: { lt: cutoff },
      },
      data: { outcome: AiGenerationOutcome.DISCARDED },
    });

    if (result.count > 0) {
      this.logger.log(
        `Swept ${result.count} unreferenced draft(s) to DISCARDED`,
      );
    }

    return result.count;
  }

  /**
   * Acceptance rate over a window — the number the sweep exists to make true.
   *
   * Divides by every draft with a decided outcome, including DISCARDED. Divide
   * by only ACCEPTED + EDITED and the answer is near 100% regardless of
   * quality, which is the reading this whole mechanism exists to prevent.
   */
  async acceptanceRate(
    organizationId: string,
    since: Date,
  ): Promise<{
    accepted: number;
    edited: number;
    discarded: number;
    rate: number;
  }> {
    const rows = await this.prisma.aiGeneration.groupBy({
      by: ['outcome'],
      where: {
        organizationId,
        purpose: AiGenerationPurpose.DRAFT,
        outcome: { not: null },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    // Typed explicitly rather than via `Object.fromEntries`, whose return type
    // is `any` — which would silently disable checking on every lookup below
    // and let a renamed outcome read as `undefined` forever.
    const counts = new Map<string, number>(
      rows.map((row) => [row.outcome ?? '', row._count._all]),
    );

    const accepted = counts.get(AiGenerationOutcome.ACCEPTED) ?? 0;
    const edited = counts.get(AiGenerationOutcome.EDITED) ?? 0;
    const discarded = counts.get(AiGenerationOutcome.DISCARDED) ?? 0;
    const total = accepted + edited + discarded;

    return {
      accepted,
      edited,
      discarded,
      // Zero rather than NaN for an empty window. A dashboard rendering NaN
      // teaches people to ignore the number.
      rate: total === 0 ? 0 : accepted / total,
    };
  }
}

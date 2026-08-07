import { Injectable, Logger } from '@nestjs/common';
import {
  backfillWindow,
  formatErrorMsg,
  RollupWindow,
  safeTimezone,
  trailingWindow,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';

const DEFAULT_TRAILING_DAYS = 2;

export type AiRollupOutcome = {
  tenants: number;
  rows: number;
};

/**
 * `ai_generation_daily_stats` — 19-doc §2.2.
 *
 * **Not an optimisation. The only durable record.** `ai_generations` is
 * retention-rolled (RDM Table 29): raw rows aggregate away after ~90 days, so
 * an analytics query written against them silently loses history the moment
 * retention ships — the same trap that made `UNCITED` a projection rather than
 * a query (12-doc §4.1).
 *
 * **Which makes the ordering constraint real: this runs BEFORE retention over
 * the same window**, exactly like `ChunkUsageProjection`. Reversed, retention
 * deletes rows this has not read, and every historical figure under-reports
 * forever with nothing to recompute it from. `ScheduledJobsService` owns that
 * ordering; this class only insists on it in a comment and a test.
 *
 * Same shape as every other job here: a plain method taking a window, no
 * `@Cron`. A job triggered by a schedule can only be tested by waiting, and a
 * test that waits gets deleted.
 */
@Injectable()
export class AiGenerationRollupJob {
  private readonly logger = new Logger(AiGenerationRollupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
  ) {}

  async run(
    now: Date = new Date(),
    days: number = DEFAULT_TRAILING_DAYS,
  ): Promise<AiRollupOutcome> {
    return this.rollup(trailingWindow(now, days));
  }

  /**
   * The BACKFILL entry point — 19-doc §2.3.
   *
   * Load-bearing here in a way it is not for tickets: a bug in this rollup is
   * uncorrectable once retention has eaten the raw rows, so the backfill is the
   * ONLY window in which a mistake can be fixed at all.
   */
  async backfill(fromDay: Date, toDay: Date): Promise<AiRollupOutcome> {
    this.logger.log(
      `Backfilling AI rollups ${fromDay.toISOString().slice(0, 10)} → ` +
        `${toDay.toISOString().slice(0, 10)}`,
    );

    return this.rollup(backfillWindow(fromDay, toDay));
  }

  private async rollup(window: RollupWindow): Promise<AiRollupOutcome> {
    const organizationIds = await this.activeTenants(window);
    if (organizationIds.length === 0) {
      this.logger.log('No AI activity in window; nothing to roll up');

      return { tenants: 0, rows: 0 };
    }

    const timezones =
      await this.authReference.listOrganizationTimezones(organizationIds);

    let rows = 0;

    for (const organizationId of organizationIds) {
      const timezone = safeTimezone(timezones.get(organizationId));

      try {
        rows += await this.rollupTenant(organizationId, timezone, window);
      } catch (error) {
        this.logger.error(
          `AI rollup failed for ${organizationId}: ${formatErrorMsg(error)}`,
        );
      }
    }

    this.logger.log(
      `Rolled up ${rows} AI stat row(s) across ${organizationIds.length} tenant(s)`,
    );

    return { tenants: organizationIds.length, rows };
  }

  private async activeTenants(window: RollupWindow): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT DISTINCT organization_id FROM ai_generations
      WHERE created_at >= ${window.since} AND created_at < ${window.until}
    `;

    return rows.map((row) => row.organization_id);
  }

  /**
   * One statement per tenant, grouped by (day, purpose, model).
   *
   * Delete-then-insert inside a transaction, like the ticket rollup, so a
   * re-run recomputes rather than accumulates. Here the unique key has no
   * NULLable column, so `ON CONFLICT` would work — using the same shape as the
   * other job is worth more than saving a statement, because two rollups that
   * behave differently under re-run is exactly the kind of difference nobody
   * remembers when debugging a doubled number.
   */
  private async rollupTenant(
    organizationId: string,
    timezone: string,
    window: RollupWindow,
  ): Promise<number> {
    const [, inserted] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        `
        DELETE FROM ai_generation_daily_stats
        WHERE organization_id = $1::uuid
          AND day >= ($2::timestamptz AT TIME ZONE $4)::date
          AND day <= ($3::timestamptz AT TIME ZONE $4)::date
        `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
      this.prisma.$executeRawUnsafe(
        `
        INSERT INTO ai_generation_daily_stats (
          id, organization_id, day, purpose, model_name,
          generations, prompt_tokens, completion_tokens, cost_micros,
          latency_ms_sum, latency_count,
          failures, empty_retrievals,
          drafts_accepted, drafts_edited, drafts_discarded,
          computed_at
        )
        SELECT gen_random_uuid(),
               $1::uuid,
               (g.created_at AT TIME ZONE $4)::date,
               g.purpose,
               g.model_name,
               COUNT(*)::int,
               COALESCE(SUM(g.prompt_tokens), 0),
               COALESCE(SUM(g.completion_tokens), 0),
               COALESCE(SUM(g.estimated_cost_micros), 0),
               -- Sum and count, so the mean is computed at read time. A stored
               -- average would weight a quiet day equally with a busy one.
               COALESCE(SUM(g.latency_ms), 0),
               COUNT(g.latency_ms)::int,
               COUNT(*) FILTER (WHERE g.status <> 'SUCCESS')::int,
               -- **The knowledge-gap signal.** A generation that retrieved
               -- nothing is a question the corpus could not answer — a content
               -- backlog item rather than an error, and invisible in every
               -- other counter here.
               COUNT(*) FILTER (
                 WHERE g.purpose IN ('CHAT_ANSWER', 'DRAFT')
                   AND COALESCE(array_length(g.retrieved_chunk_ids, 1), 0) = 0
               )::int,
               COUNT(*) FILTER (WHERE g.outcome = 'ACCEPTED')::int,
               COUNT(*) FILTER (WHERE g.outcome = 'EDITED')::int,
               -- The denominator's third term, and the one that depends on the
               -- sweep (12-doc §4.3). Without it, acceptance divides by drafts
               -- that were USED and reports ~100% regardless of quality.
               COUNT(*) FILTER (WHERE g.outcome = 'DISCARDED')::int,
               NOW()
        FROM ai_generations g
        WHERE g.organization_id = $1::uuid
          AND g.created_at >= $2::timestamptz
          AND g.created_at <  $3::timestamptz
        GROUP BY 3, 4, 5
        `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
    ]);

    return inserted;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import {
  CONFLICT_SWEEP_PER_TENANT,
  DocumentStatus,
  PROJECTION_LAG_MS,
  ROLLUP_TRAILING_DAYS,
} from '@synapsedesk/contracts';
import { formatErrorMsg, JobRunRecorder } from '@synapsedesk/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChunkUsageProjection,
  ProjectionCursorMissingError,
} from '../scheduled/chunk-usage.projection';
import { DocumentFlagWriter } from '../scheduled/document-flag-writer';
import { ConflictCheckQueueService } from '../ingestion/conflict-check-queue.service';
import { AiGenerationRollupJob } from '../analytics/ai-generation-rollup.job';

/** What one `ledger.daily` run did: the rollup's counts and any step that failed. */
export interface LedgerDailyOutcome {
  tenants: number;
  rows: number;
  failed: string[];
}

/**
 * Runs one step, logs its outcome, and **does not let a failure stop the
 * sequence**: one bad tenant's projection mustn't cost the night's rollup and
 * flags as well. Each step gets its own heartbeat row as well as the job's, so
 * a night in which the projection failed and only the rollup ran doesn't read
 * as "succeeded".
 *
 * @returns whether the step succeeded.
 */
export async function runStep(
  runs: JobRunRecorder,
  logger: Logger,
  name: string,
  run: () => Promise<string>,
): Promise<boolean> {
  const startedAt = Date.now();

  try {
    const summary = await runs.track(name, run);

    logger.log(`${name}: ${summary} (${Date.now() - startedAt}ms)`);
    return true;
  } catch (error) {
    logger.error(
      `${name} FAILED after ${Date.now() - startedAt}ms: ${formatErrorMsg(error)}`,
    );
    return false;
  }
}

/**
 * `ledger.daily`: **projection → rollup → flags**, and the order is
 * load-bearing. The schedule runs it nightly, and a platform operator runs the
 * same sequence by hand (`POST /platform/jobs/ledger-daily/run`).
 *
 *   1. `ChunkUsageProjection` first. It reads the retrieved/cited chunk id
 *      arrays on `ai_generations`, which ledger retention will eventually
 *      drop — anything that runs after retention reads nothing, permanently.
 *   2. `AiGenerationRollupJob` second, for the same reason: it aggregates the
 *      same rows retention removes.
 *   3. `DocumentFlagWriter`, because `UNRETRIEVED` and `UNCITED` are
 *      computed from the counters step 1 writes. Flagging first means
 *      flagging against yesterday's numbers.
 *   4. The conflict sweep: queues up to `CONFLICT_SWEEP_PER_TENANT`
 *      never-checked documents per tenant. It only queues; the checks run on
 *      their own queue and spend as they go.
 *
 * When retention is built it goes at the END of this sequence and nowhere
 * else.
 *
 * **Steps 1 and 2 have the same re-run semantics by opposite mechanisms.**
 * The rollup deletes and re-inserts, so recomputing an interval it already
 * covered is free; the projection ADDS, so it cannot recompute and takes a
 * cursor instead.
 *
 * **What that does NOT buy is sequencing.** A failed step is logged and the
 * next still runs — a projection that throws still lets `document-flags`
 * compute against counters this run did not write. The cursor makes those
 * counters STALE rather than wrong, and the next run closes the gap however
 * long the outage.
 */
@Injectable()
export class LedgerDailySequence {
  private readonly logger = new Logger(LedgerDailySequence.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ChunkUsageProjection,
    private readonly flags: DocumentFlagWriter,
    private readonly conflicts: ConflictCheckQueueService,
    private readonly aiRollup: AiGenerationRollupJob,
    private readonly runs: JobRunRecorder,
  ) {}

  /**
   * @param options.seedCursor a database whose projection has never run has
   *   no cursor, and the nightly run refuses to invent one: seeding it resets
   *   every chunk counter. A by-hand run is somebody's deliberate command, so
   *   it may seed it (the same batched backfill as `projection:backfill`).
   */
  async run(options: { seedCursor: boolean }): Promise<LedgerDailyOutcome> {
    const failed: string[] = [];
    let rollup = { tenants: 0, rows: 0 };

    const projected = await runStep(
      this.runs,
      this.logger,
      'chunk-usage-projection',
      async () => {
        // **Cursor-driven, so it gets an upper bound and finds its own lower
        // one.** It ADDS to the chunk counters, so an interval overlapping
        // its predecessor counts a generation twice. The lag is what a cursor
        // needs and a window does not: see `PROJECTION_LAG_MS`.
        const until = new Date(Date.now() - PROJECTION_LAG_MS);
        const updated = await this.projection.project(until).catch((error) => {
          if (
            options.seedCursor &&
            error instanceof ProjectionCursorMissingError
          ) {
            return this.projection.backfill(until);
          }
          throw error;
        });

        return `${updated} chunk counter(s) updated`;
      },
    );
    if (!projected) failed.push('chunk-usage-projection');

    const rolledUp = await runStep(
      this.runs,
      this.logger,
      'ai-generation-rollup',
      async () => {
        // Window-driven, and correctly so: this step deletes and re-inserts,
        // so recomputing a day it already had is free and a wide window only
        // self-heals a missed night.
        rollup = await this.aiRollup.run(new Date(), ROLLUP_TRAILING_DAYS);

        return `${rollup.tenants} tenant(s), ${rollup.rows} row(s)`;
      },
    );
    if (!rolledUp) failed.push('ai-generation-rollup');

    // Per tenant, because `detect()` is scoped to one. Tenants are read from
    // the documents table rather than from auth-service: a tenant with no
    // documents has nothing to flag, and asking auth-service would add a
    // cross-service dependency to a job that does not need one.
    const flagged = await runStep(
      this.runs,
      this.logger,
      'document-flags',
      async () => {
        const tenants = await this.prisma.document.groupBy({
          by: ['organizationId'],
          where: { deletedAt: null },
        });

        let count = 0;
        for (const tenant of tenants) {
          count += await this.flags.detect(tenant.organizationId);
        }

        return `${count} flag(s) across ${tenants.length} tenant(s)`;
      },
    );
    if (!flagged) failed.push('document-flags');

    // The corpus no check has completed for: documents from before the
    // detector, and checks stopped at the cap or by a failure. The oldest
    // first, a bounded number per tenant, so one large tenant can't spend a
    // night's judging for everyone.
    const swept = await runStep(
      this.runs,
      this.logger,
      'conflict-sweep',
      async () => {
        const unchecked = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM (
            SELECT id,
                   row_number() OVER (
                     PARTITION BY organization_id ORDER BY created_at
                   ) AS position
            FROM documents
            WHERE conflicts_checked_at IS NULL
              AND deleted_at IS NULL
              AND status = ${DocumentStatus.INDEXED}
          ) ranked
          WHERE position <= ${CONFLICT_SWEEP_PER_TENANT}
        `;
        for (const document of unchecked) {
          await this.conflicts.enqueue(document.id);
        }

        return `${unchecked.length} document(s) queued`;
      },
    );
    if (!swept) failed.push('conflict-sweep');

    return { ...rollup, failed };
  }
}

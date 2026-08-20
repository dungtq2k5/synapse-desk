import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  formatErrorMsg,
  ROLLUP_TRAILING_DAYS,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
  trailingWindow,
  JobRunRecorder,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkUsageProjection } from '../scheduled/chunk-usage.projection';
import { DiscardedDraftSweep } from '../scheduled/discarded-draft.sweep';
import { DocumentFlagWriter } from '../scheduled/document-flag-writer';
import { QuotaReconciliationJob } from '../scheduled/quota-reconciliation.job';
import { AiGenerationRollupJob } from '../analytics/ai-generation-rollup.job';

/**
 * The thing that was missing
 *
 * Six jobs in this service were written correctly and called by nothing. This
 * class is the caller, and it is deliberately thin: it decides WHEN and in what
 * ORDER, and contains no logic of its own. The jobs stay plain methods taking
 * explicit windows, which is what keeps them testable without waiting on a
 * clock.
 *
 * **The ordering inside `ledger.daily` is a correctness constraint, not a
 * preference.** Encoded as one job calling three in sequence rather than as
 * three cron entries minutes apart — see `JOB_SEQUENCES`. Two cron entries
 * work until the first job takes longer than the gap between them, and then
 * they fail by destroying data the next one had not read.
 */
@Processor(SCHEDULER_QUEUE.ingestion, {
  // One at a time. These are bulk sweeps over a tenant's history; running the
  // hourly and the daily concurrently would put them in contention for exactly
  // the rows they are both rewriting.
  concurrency: 1,
})
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ChunkUsageProjection,
    private readonly draftSweep: DiscardedDraftSweep,
    private readonly quota: QuotaReconciliationJob,
    private readonly flags: DocumentFlagWriter,
    private readonly aiRollup: AiGenerationRollupJob,
    private readonly runs: JobRunRecorder,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULED_JOBS.LEDGER_HOURLY:
        return this.runs.track(job.name, () => this.hourly());
      case SCHEDULED_JOBS.LEDGER_DAILY:
        return this.runs.track(job.name, () => this.daily());
      default:
        // **A defect, not routine cross-talk** — and the difference is what
        // makes throwing correct now.
        //
        // This branch used to `return`, which reported SUCCESS to BullMQ for
        // work nobody did — and it fired constantly, because all three services
        // shared one queue and each one received the other two's jobs. Every
        // stolen run was marked complete and its schedule advanced.
        //
        // With one queue per service a job can only arrive at its owner, so a
        // name this build does not know is what the old comment always claimed
        // it was: a repeat entry left by an older deploy. It belongs in
        // `failed`, where it is visible and queryable, and where it stops
        // pretending the schedule ran.
        //
        // Retrying cannot bury the real jobs: the repeat entry carries
        // `attempts: 3` with exponential backoff, so this exhausts and stops
        // rather than looping.
        throw new Error(`Unknown scheduled job '${job.name}'`);
    }
  }

  /**
   * Hourly: draft outcomes, then quota drift.
   *
   * Both correct a divergence that GROWS with time, which is why they are not
   * daily. An unswept draft is a denominator that overstates acceptance for
   * every hour it sits there, and counter drift is a budget gate deciding
   * against a number nobody has checked against the ledger.
   *
   * Unordered relative to each other — they touch different things — but run in
   * sequence anyway so one long sweep cannot overlap the other.
   */
  private async hourly(): Promise<void> {
    await this.step('discarded-draft-sweep', async () => {
      const swept = await this.draftSweep.sweep();

      return `${swept} draft(s) marked discarded`;
    });

    await this.step('quota-reconcile', async () => {
      const reconciled = await this.quota.reconcileAll();

      return `${reconciled} tenant(s) reconciled`;
    });
  }

  /**
   * Daily: **projection → rollup → flags**, and the order is load-bearing.
   *
   *   1. `ChunkUsageProjection` first. It reads the retrieved/cited chunk id
   *      arrays on `ai_generations`, which ledger retention will eventually
   *      drop — anything that runs after retention reads nothing, permanently.
   *   2. `AiGenerationRollupJob` second, for the same reason: it aggregates the
   *      same rows retention removes.
   *   3. `DocumentFlagWriter` LAST, because `UNRETRIEVED` and `UNCITED` are
   *      computed from the counters step 1 writes. Flagging first means
   *      flagging against yesterday's numbers.
   *
   * When retention is built it goes at the END of this method and nowhere else.
   */
  private async daily(): Promise<void> {
    const window = trailingWindow(new Date(), ROLLUP_TRAILING_DAYS);

    await this.step('chunk-usage-projection', async () => {
      const updated = await this.projection.project(window.since, window.until);

      return `${updated} chunk counter(s) updated`;
    });

    await this.step('ai-generation-rollup', async () => {
      const outcome = await this.aiRollup.run(new Date(), ROLLUP_TRAILING_DAYS);

      return `${outcome.tenants} tenant(s), ${outcome.rows} row(s)`;
    });

    // Per tenant, because `detect()` is scoped to one. Tenants are read from
    // the documents table rather than from auth-service: a tenant with no
    // documents has nothing to flag, and asking auth-service would add a
    // cross-service dependency to a job that does not need one.
    await this.step('document-flags', async () => {
      const tenants = await this.prisma.document.groupBy({
        by: ['organizationId'],
        where: { deletedAt: null },
      });

      let flagged = 0;
      for (const tenant of tenants) {
        flagged += await this.flags.detect(tenant.organizationId);
      }

      return `${flagged} flag(s) across ${tenants.length} tenant(s)`;
    });
  }

  /**
   * Runs one step, logs its outcome, and **does not let a failure stop the
   * sequence**.
   *
   * A step that throws is logged and the next one still runs test
   * 5. The alternative would let one bad tenant's projection cost that night's
   * rollup and flags as well, turning a small fault into a missing day.
   *
   * The order still holds under failure: a failed projection means the rollup
   * runs against stale counters, which is worse than nothing only if it also
   * hides. It does not — the error is logged and the heartbeat records it.
   */
  private async step(name: string, run: () => Promise<string>): Promise<void> {
    const startedAt = Date.now();

    try {
      // Each STEP gets its own heartbeat row as well as the job's. The job's
      // row would otherwise read "succeeded" for a night in which the
      // projection failed and only the rollup ran — which is the difference
      // between "we have numbers" and "we have the right numbers".
      const summary = await this.runs.track(name, run);

      this.logger.log(`${name}: ${summary} (${Date.now() - startedAt}ms)`);
    } catch (error) {
      this.logger.error(
        `${name} FAILED after ${Date.now() - startedAt}ms: ${formatErrorMsg(error)}`,
      );
    }
  }
}

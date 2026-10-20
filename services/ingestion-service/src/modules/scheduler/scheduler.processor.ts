import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SCHEDULED_JOBS, SCHEDULER_QUEUE } from '@synapsedesk/contracts';
import { JobRunRecorder } from '@synapsedesk/nest-common';
import { DiscardedDraftSweep } from '../scheduled/discarded-draft.sweep';
import { QuotaReconciliationJob } from '../scheduled/quota-reconciliation.job';
import { ScopeReconcileSweep } from '../ingestion/scope-reconcile.sweep';
import { IngestionReconcileSweep } from '../ingestion/ingestion-reconcile.sweep';
import { LedgerDailySequence, runStep } from './ledger-daily.sequence';

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
    private readonly draftSweep: DiscardedDraftSweep,
    private readonly quota: QuotaReconciliationJob,
    private readonly sequence: LedgerDailySequence,
    private readonly reconcile: IngestionReconcileSweep,
    private readonly runs: JobRunRecorder,
    private readonly scopeReconcile: ScopeReconcileSweep,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULED_JOBS.LEDGER_HOURLY:
        return this.runs.track(job.name, () => this.hourly());
      case SCHEDULED_JOBS.LEDGER_DAILY:
        return this.runs.track(job.name, () => this.daily());
      case SCHEDULED_JOBS.INGESTION_RECONCILE:
        // Tracked like the others even though it usually finds nothing: a
        // sweep that only writes a heartbeat when it has work reports
        // `never-ran` on a healthy system, which is the one thing
        // `/platform/jobs` exists to distinguish.
        return this.runs.track(job.name, async () => {
          await this.reconcile.sweep();
        });
      case SCHEDULED_JOBS.SCOPE_RECONCILE:
        // Tracked unconditionally, same reason as the reconcile above: a sweep
        // that heartbeats only when it finds drift reports `never-ran` on a
        // healthy system.
        return this.runs.track(job.name, async () => {
          await this.scopeReconcile.sweep();
        });

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

  /** Daily: the `ledger.daily` sequence, unseeded (see `LedgerDailySequence`). */
  private async daily(): Promise<void> {
    await this.sequence.run({ seedCursor: false });
  }

  private async step(name: string, run: () => Promise<string>): Promise<void> {
    await runStep(this.runs, this.logger, name, run);
  }
}

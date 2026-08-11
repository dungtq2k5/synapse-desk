import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  formatErrorMsg,
  ROLLUP_TRAILING_DAYS,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
  JobRunRecorder,
} from '@synapsedesk/common';
import { TicketRollupJob } from '../analytics/ticket-rollup.job';

/**
 * The caller `TicketRollupJob` never had — 20-doc §1, §2.
 *
 * Without this, `ticket_daily_stats` and `agent_daily_stats` were never
 * written, and **all six analytics endpoints returned zeros** — correctly, from
 * empty tables, which is why every test passed.
 *
 * One step rather than a sequence: nothing in ticket-service has an ordering
 * constraint against anything else. The structure still matches
 * ingestion-service's deliberately — the next scheduled job added here will be
 * copied from whatever is already present, and two shapes for one concern is
 * how a third appears.
 */
@Processor(SCHEDULER_QUEUE.ticket, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    private readonly rollup: TicketRollupJob,
    private readonly runs: JobRunRecorder,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SCHEDULED_JOBS.ANALYTICS_DAILY) {
      // **A defect, not routine cross-talk** — and the difference is what makes
      // throwing correct now.
      //
      // This branch used to `return`, which reported SUCCESS to BullMQ for work
      // nobody did. It is where the shared-queue bug was OBSERVED: all three
      // services ran a worker on one queue, so `ledger-hourly` and `auth-hourly`
      // arrived here, were logged as ignored, and were recorded as complete —
      // and their schedules advanced as though they had run.
      //
      // With one queue per service a job can only arrive at its owner, so a name
      // this build does not know is what the old comment always claimed it was:
      // a repeat entry left by an older deploy. It belongs in `failed`, where it
      // is visible and stops pretending the schedule ran.
      //
      // Retrying cannot bury the real jobs: the repeat entry carries
      // `attempts: 3` with exponential backoff, so this exhausts and stops.
      throw new Error(`Unknown scheduled job '${job.name}'`);
    }

    const startedAt = Date.now();

    // Wrapped so a run that never happens is visible as an ageing
    // `last_succeeded_at` rather than as silence — 20-doc §4.1.
    return this.runs.track(job.name, async () => {
      try {
        // **A TRAILING window, not yesterday.** This is what makes one 02:00 UTC
        // schedule correct for tenants in every timezone: a tenant whose local
        // day closes after 02:00 UTC is picked up by the next run. Narrow this to
        // a single day and the schedule silently starts losing the last day for
        // every tenant east of UTC.
        const outcome = await this.rollup.run(new Date(), ROLLUP_TRAILING_DAYS);

        this.logger.log(
          `ticket-rollup: ${outcome.tenants} tenant(s), ` +
            `${outcome.ticketRows} ticket row(s), ${outcome.agentRows} agent ` +
            `row(s) (${Date.now() - startedAt}ms)`,
        );
      } catch (error) {
        this.logger.error(
          `ticket-rollup FAILED after ${Date.now() - startedAt}ms: ` +
            formatErrorMsg(error),
        );

        // Rethrown so BullMQ retries and the job state records the failure — the
        // difference between "it broke" and "it was never wired", which look
        // identical from a dashboard of zeros.
        throw error;
      }
    });
  }
}

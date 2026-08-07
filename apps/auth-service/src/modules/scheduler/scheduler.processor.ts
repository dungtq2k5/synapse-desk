import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  formatErrorMsg,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
  JobRunRecorder,
} from '@synapsedesk/common';
import { InvitationsService } from '../invitations/invitations.service';
import { ExpiredRecordsPruner } from '../sessions/expired-records.job';

/**
 * auth-service's scheduler — 20-doc §3.2.
 *
 * **Migrated off `@nestjs/schedule`, which had the replica problem.** Both jobs
 * here used `@Cron`, which runs in-process: three pods fired each of them three
 * times, and under a rolling deploy zero or four. Both are idempotent deletes,
 * so the impact was duplicated work rather than wrong data — genuinely low
 * severity on its own.
 *
 * It was worth changing for a different reason. **Two mechanisms for one
 * concern is how a third appears**: whoever adds the next scheduled job copies
 * whichever they find first, and after 20-doc there were two schedulers in this
 * codebase built on BullMQ and one built on decorators. Now there is one way.
 */
@Processor(SCHEDULER_QUEUE, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    private readonly invitations: InvitationsService,
    private readonly pruner: ExpiredRecordsPruner,
    private readonly runs: JobRunRecorder,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULED_JOBS.AUTH_HOURLY:
        return this.runs.track(job.name, () => this.hourly());
      case SCHEDULED_JOBS.AUTH_DAILY:
        return this.runs.track(job.name, () => this.daily());
      default:
        // A repeat entry left by an older deploy under a name this build no
        // longer knows. Logged rather than thrown: retrying forever would bury
        // the jobs that do exist.
        this.logger.warn(`Ignoring unknown scheduled job '${job.name}'`);
    }
  }

  /**
   * Expires stale invitations.
   *
   * **Releases reserved SEATS**, which is why it is hourly rather than daily:
   * `seatsInUse()` counts PENDING invitations, so a tenant at their limit
   * cannot invite anybody until this runs.
   */
  private async hourly(): Promise<void> {
    const { expiredCount } = await this.invitations.expireStaleInvitations();

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} stale invitation(s)`);
    }
  }

  /**
   * Prunes rows that are already unusable.
   *
   * The sweep reclaims space; it enforces nothing — an expired session is
   * rejected on its own merits whether or not the row is still there. So a
   * missed night costs disk, not correctness.
   */
  private async daily(): Promise<void> {
    const pruned = await this.pruner.prune();

    if (pruned > 0) {
      this.logger.log(`Pruned ${pruned} expired row(s)`);
    }
  }
}

export { formatErrorMsg };

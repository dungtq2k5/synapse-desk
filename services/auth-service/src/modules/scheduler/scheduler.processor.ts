import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
  JobRunRecorder,
} from '@synapsedesk/common';
import { InvitationsService } from '../invitations/invitations.service';
import { ExpiredLockSweep } from '../users/expired-lock.sweep';
import { ExpiredRecordsPruner } from '../sessions/expired-records.job';
import { BillingSnapshotJob } from '../finance/billing-snapshot.job';

/**
 * auth-service's scheduler.
 *
 * **Migrated off `@nestjs/schedule`, which had the replica problem.** Both jobs
 * here used `@Cron`, which runs in-process: three pods fired each of them three
 * times, and under a rolling deploy zero or four. Both are idempotent deletes,
 * so the impact was duplicated work rather than wrong data — genuinely low
 * severity on its own.
 *
 * It was worth changing for a different reason. **Two mechanisms for one
 * concern is how a third appears**: whoever adds the next scheduled job copies
 * whichever they find first, and at one point there were two schedulers in this
 * codebase built on BullMQ and one built on decorators. Now there is one way.
 */
@Processor(SCHEDULER_QUEUE.auth, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    private readonly invitations: InvitationsService,
    private readonly pruner: ExpiredRecordsPruner,
    private readonly expiredLocks: ExpiredLockSweep,
    private readonly runs: JobRunRecorder,
    private readonly billingSnapshot: BillingSnapshotJob,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULED_JOBS.AUTH_HOURLY:
        return this.runs.track(job.name, () => this.hourly());
      case SCHEDULED_JOBS.AUTH_DAILY:
        return this.runs.track(job.name, () => this.daily());
      // **Its own heartbeat, which is the whole reason it is its own job.**
      // `track` records one row per job name, so folding this into
      // `AUTH_HOURLY` would report invitation expiry as failing whenever Stripe
      // is down — a job that ran perfectly, red in `/platform/jobs`.
      case SCHEDULED_JOBS.BILLING_SNAPSHOT:
        return this.runs.track(job.name, () => this.billingSnapshot.run());
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

    // **Expired temporary locks**, mechanism 2.
    //
    // The login path already unlocks lazily, so this is not what lets a user
    // back in — that is instant. What it fixes is everything that does NOT go
    // through login: list filters, both notification audiences and the
    // last-Org-Admin count, none of which know about time and none of which
    // should have to. It is why `is_locked` could stay the single authoritative
    // boolean and this feature touched three call sites instead of 22.
    await this.expiredLocks.sweep();
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

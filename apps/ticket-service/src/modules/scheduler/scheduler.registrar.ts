import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  formatErrorMsg,
  jobsOwnedBy,
  repeatJobId,
  SCHEDULE_CRON,
  ScheduledJobName,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';

/**
 * Registers this service's repeat entry on boot.
 *
 * **`onApplicationBootstrap`, not `onModuleInit`.** The first scheduled tick
 * can arrive as soon as the entry exists, and it calls into jobs across several
 * modules; registering before every module has initialized invites a job that
 * fires against a half-built dependency graph.
 *
 * **Stable `jobId`s, which is the whole trick.** Without one, every deploy adds
 * another repeat entry for the same cron and the job quietly begins running
 * twice, then three times, then once per deploy this month — with no error
 * anywhere, because each run individually succeeds. With one, re-registering is
 * idempotent and a redeploy REPLACES the schedule.
 */
@Injectable()
export class SchedulerRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerRegistrar.name);

  constructor(
    @InjectQueue(SCHEDULER_QUEUE.ticket) private readonly queue: Queue,
  ) {}

  /**
   * Every job this service owns, from {@link JOB_SERVICE}.
   *
   * Iterated rather than listed: naming them here made adding a job a
   * four-place edit with only three places checked, and the unchecked one
   * produced a job `/platform/jobs` expected and BullMQ had never heard of.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const name of jobsOwnedBy('ticket')) {
      await this.register(name);
    }
  }

  /**
   * One repeat entry, idempotently.
   *
   * A failure here is logged rather than thrown: a service that will not boot
   * because Redis was briefly unavailable is a worse outcome than one whose
   * schedule is missing — and the staleness alert is what catches the
   * latter. Throwing would also make the failure mode "no service at all"
   * rather than "no rollups", which is a strictly larger blast radius.
   */
  private async register(name: ScheduledJobName): Promise<void> {
    const pattern = SCHEDULE_CRON[name];

    try {
      // `upsertJobScheduler` rather than `add({ repeat })`: the scheduler id is
      // EXPLICIT, so re-registering is an update by name rather than a
      // deduplication that happens to work out. The legacy form derives its key
      // by hashing the repeat options — which means changing a cron pattern
      // leaves the OLD entry in place and adds a second one, and the job starts
      // running on both schedules with nothing to indicate it.
      await this.queue.upsertJobScheduler(
        // The stable id — see the class docblock. No colons: BullMQ uses them
        // as its own Redis key delimiter and rejects an id containing one,
        // which fails as "the schedule silently did not register".
        repeatJobId(name),
        { pattern },
        {
          name,
          data: {},
          opts: {
            // A run that fails is retried twice within the hour rather than
            // waiting for the next tick. Beyond that the schedule itself is the
            // retry — these jobs recompute a trailing window, so the next run
            // repairs whatever this one missed.
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
      );

      this.logger.log(`Scheduled '${name}' (${pattern})`);
    } catch (error) {
      this.logger.error(
        `Could not schedule '${name}': ${formatErrorMsg(error)}`,
      );
    }
  }
}

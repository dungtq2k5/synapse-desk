import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  JobRunRecorder,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';
import { WebhookRetentionJob } from '../webhooks/webhook-retention.job';

/**
 * notification-service's scheduler — the FOURTH, and webhooks are why.
 *
 * This service had no scheduled work until `webhook_deliveries` needed a
 * retention sweep, and the shape is auth-service's verbatim: one queue per
 * service (the map's own warning — a shared name silently deletes work), one
 * heartbeat per job via `JobRunRecorder`, and an unknown name THROWS so a
 * repeat entry left by an older deploy lands in `failed` instead of pretending
 * the schedule ran.
 */
@Processor(SCHEDULER_QUEUE.notification, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  constructor(
    private readonly retention: WebhookRetentionJob,
    private readonly runs: JobRunRecorder,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULED_JOBS.WEBHOOK_RETENTION:
        return this.runs.track(job.name, () => this.retention.run());
      default:
        throw new Error(`Unknown scheduled job '${job.name}'`);
    }
  }
}

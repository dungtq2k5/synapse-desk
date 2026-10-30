import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  CONFLICT_CHECK_JOB_NAME,
  CONFLICT_CHECK_QUEUE,
} from '@synapsedesk/contracts';
import { ConflictCheckService } from './conflict-check.service';
import type { ConflictCheckJobData } from './conflict-check-queue.service';

/**
 * The BullMQ half of the conflict check.
 *
 * Concurrency 1: every job spends the tenant's AI allowance on judge calls,
 * and two at once would race the same budget check.
 */
@Processor(CONFLICT_CHECK_QUEUE, { concurrency: 1 })
export class ConflictCheckWorker extends WorkerHost {
  private readonly logger = new Logger(ConflictCheckWorker.name);

  constructor(private readonly conflicts: ConflictCheckService) {
    super();
  }

  async process(job: Job<ConflictCheckJobData>): Promise<void> {
    if (job.name !== CONFLICT_CHECK_JOB_NAME) {
      this.logger.warn(`Ignoring unknown job '${job.name}' on this queue`);
      return;
    }

    await this.conflicts.check(job.data.documentId);
  }
}

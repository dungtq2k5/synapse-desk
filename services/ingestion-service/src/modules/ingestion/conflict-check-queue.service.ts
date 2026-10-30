import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  CONFLICT_CHECK_JOB_NAME,
  CONFLICT_CHECK_QUEUE,
} from '@synapsedesk/contracts';
import { formatErrorMsg } from '@synapsedesk/nest-common';

/** The data a conflict-check job carries. */
export type ConflictCheckJobData = { documentId: string };

/**
 * Queues a document's conflict check: after its version goes live, and from
 * the nightly sweep of unchecked documents.
 *
 * One job per document while it waits (the id is the document's), and one
 * attempt: a check that stops leaves the document unchecked, and the nightly
 * sweep is its retry.
 */
@Injectable()
export class ConflictCheckQueueService {
  private readonly logger = new Logger(ConflictCheckQueueService.name);

  constructor(
    @InjectQueue(CONFLICT_CHECK_QUEUE) private readonly queue: Queue,
  ) {}

  /** Best effort: a check that isn't queued is found by the next sweep. */
  async enqueue(documentId: string): Promise<void> {
    try {
      await this.queue.add(
        CONFLICT_CHECK_JOB_NAME,
        { documentId } satisfies ConflictCheckJobData,
        {
          jobId: `conflicts-${documentId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not queue the conflict check for ${documentId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

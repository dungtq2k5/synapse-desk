import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  formatErrorMsg,
  INGESTION_QUEUE,
  INGESTION_JOB_NAME,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionJobData } from './ingestion.processor';

/**
 * Puts work on the queue and records the BullMQ id against the row.
 *
 * The `ingestion_jobs` row exists before this runs — it is created in the same
 * transaction as the document, so a crash between the two cannot leave a
 * PENDING document with nothing scheduled and nothing recording that fact. What
 * this adds is the queue side plus `bullmq_job_id`, which is the thread
 * connecting a stuck document to a job someone can inspect in Redis.
 */
@Injectable()
export class IngestionQueueService {
  private readonly logger = new Logger(IngestionQueueService.name);

  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Enqueues one document.
   *
   * `jobId` is the `ingestion_jobs` row id, which makes the enqueue
   * IDEMPOTENT: BullMQ refuses a duplicate id, so a redelivered
   * `document.uploaded` — and NATS core redelivers routinely — does not queue
   * the same document twice. Without it, the second delivery re-parses and
   * re-embeds an entire document, and the duplicate spend is silent.
   */
  async enqueue(data: IngestionJobData): Promise<void> {
    const job = await this.queue.add(INGESTION_JOB_NAME, data, {
      jobId: data.ingestionJobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    await this.prisma.ingestionJob
      .update({
        where: { id: data.ingestionJobId },
        data: { bullmqJobId: String(job.id ?? '') },
      })
      .catch((error: unknown) => {
        // Non-fatal. The job is already queued and will run; losing the id
        // costs observability, and failing here would cost the ingestion.
        this.logger.warn(
          `Queued ${data.documentId} but could not record the job id: ${formatErrorMsg(error)}`,
        );
      });
  }

  /**
   * Re-queues every job left `QUEUED` by the AI cap.
   *
   * Called when a billing cycle rolls. Deferred jobs are not retried by BullMQ
   * — a deferral completes successfully, precisely so it does not burn the
   * retry budget — so something has to put them back, and this is it.
   */
  async drainDeferred(data: IngestionJobData[]): Promise<number> {
    for (const job of data) {
      // Removed first: the original job id completed, and BullMQ will not
      // accept an add() for an id it still holds. Without this the drain is a
      // silent no-op, which reads exactly like "there was nothing to drain".
      await this.queue.remove(job.ingestionJobId).catch(() => undefined);
      await this.enqueue(job);
    }

    return data.length;
  }
}

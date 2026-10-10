import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { FinishedStatus, Queue } from 'bullmq';
import {
  formatErrorMsg,
  INGESTION_QUEUE,
  INGESTION_JOB_NAME,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionJobData } from './ingestion.processor';

/**
 * The states BullMQ never leaves, as a lookup.
 *
 * An exhaustive `Record` over `FinishedStatus`, so a member added upstream
 * fails to compile here rather than silently joining the runnable set.
 */
const FINISHED_JOB_STATES: Record<FinishedStatus, true> = {
  completed: true,
  failed: true,
};

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
   * Whether BullMQ still holds the job in a state it will run from.
   *
   * @returns `false` when BullMQ has no record of the id, or holds it in a
   * state it never leaves — which is what a cap-deferred job looks like, since
   * a deferral COMPLETES rather than failing.
   */
  async isRunnable(ingestionJobId: string): Promise<boolean> {
    const job = await this.queue.getJob(ingestionJobId);
    const state = await job?.getState();

    // Naming the FINISHED states rather than the runnable ones: an unlisted
    // state then reads as runnable, and the two mistakes are not equal —
    // "runnable" only refuses a retry, while "stranded" enqueues a second
    // worker onto a document one is already parsing. `'unknown'` lands on the
    // safe side of that asymmetry for free.
    return state !== undefined && !(state in FINISHED_JOB_STATES);
  }

  /**
   * Drops a job from the queue if it is still there.
   *
   * Best effort by design: the id may be long gone under `removeOnComplete`,
   * and an ACTIVE job is not stopped by this at all — BullMQ has no way to
   * interrupt a worker. Cancellation is the database write; this only spares
   * the queue a run that would refuse itself at the first stage boundary.
   */
  async discard(ingestionJobId: string): Promise<void> {
    await this.queue.remove(ingestionJobId).catch((error: unknown) => {
      this.logger.warn(
        `Could not remove job ${ingestionJobId} from the queue: ${formatErrorMsg(error)}`,
      );
    });
  }

  /**
   * Re-queues every job left `QUEUED` by the AI cap.
   *
   * Deferred jobs are not retried by BullMQ — a deferral completes
   * successfully, precisely so it does not burn the retry budget — so something
   * has to put them back, and this is it.
   *
   * **Called by `IngestionReconcileSweep`, every ten minutes.** It was written
   * for a billing-cycle roll and had no caller for exactly as long, because
   * nothing rolls a cycle on a schedule: the cycle advances on the Stripe path
   * (`entitlement-writer.service.ts`), so a hook there would have covered this
   * and never covered a lost `document.uploaded`. A poll covers both.
   *
   * A cycle-roll hook remains a reasonable addition — it would drain within
   * seconds of a payment rather than within ten minutes — but it is an
   * optimisation on top of the sweep rather than a replacement for it.
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

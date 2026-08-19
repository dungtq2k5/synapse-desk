import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { INGESTION_QUEUE, INGESTION_JOB_NAME } from '@synapsedesk/common';
import { IngestionJobData, IngestionProcessor } from './ingestion.processor';
import { INGESTION_OUTCOMES } from '../../common/configs/ingestion.config';

/**
 * The BullMQ half — retries, concurrency and nothing else.
 *
 * All the domain logic is in `IngestionProcessor`, which knows nothing about
 * queues. That split is what lets the pipeline be tested by calling one method
 * with one object, rather than by starting Redis and waiting for a worker to
 * pick something up — and a pipeline whose tests are slow and racy is a
 * pipeline that stops being tested.
 */
@Processor(INGESTION_QUEUE, {
  // Deliberately low. Each job holds a whole document in memory, parses it on
  // the CPU and makes several embedding calls; a high concurrency here turns
  // one large upload burst into an out-of-memory kill rather than a queue.
  concurrency: 2,
})
export class IngestionWorker extends WorkerHost {
  private readonly logger = new Logger(IngestionWorker.name);

  constructor(private readonly processor: IngestionProcessor) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    if (job.name !== INGESTION_JOB_NAME) {
      this.logger.warn(`Ignoring unknown job '${job.name}' on this queue`);
      return;
    }

    const outcome = await this.processor.process(job.data);

    // A deferral is a SUCCESS as far as BullMQ is concerned, and that is the
    // point: throwing would burn the retry budget and eventually mark the job
    // failed, which is exactly the outcome RDM §1.14 forbids — a tenant who
    // overspent on chat must not also lose document onboarding. The requeue is
    // the cycle-roll drain, not a retry.
    if (outcome === INGESTION_OUTCOMES.DEFERRED) {
      this.logger.debug(`Job ${job.id} deferred; awaiting the cycle roll`);
    }
  }
}

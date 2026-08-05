import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DocumentScopeChangedEvent,
  SCOPE_FANOUT_JOB_NAME,
  SCOPE_FANOUT_QUEUE,
} from '@synapsedesk/common';
import { ScopeWriterService } from './scope-writer.service';

/**
 * The RECONCILER — §2.3, and it is deliberately not the writer.
 *
 * The endpoint already applied the change to both retrievable stores before it
 * returned (`ScopeWriterService.apply`), in the order that makes a partial
 * failure safe. What this adds is DURABILITY: a 400-chunk document is hundreds
 * of rows plus several Qdrant batches, and any of those writes can fail after
 * the response has gone. Without a retried job, that failure is permanent and
 * invisible.
 *
 * **A job rather than a loop in the handler**, and the difference is what
 * happens on failure: an HTTP timeout mid-way leaves the stores disagreeing
 * with no retry and no record, while a job backs off and converges.
 *
 * Idempotent by construction — it writes an absolute scope, not a delta — so
 * re-running it after a partial success is a no-op rather than a correction.
 */
@Processor(SCOPE_FANOUT_QUEUE, {
  // Higher than the ingestion worker's. These jobs are short and can arrive in
  // bursts when an admin reorganises departments, and each one is a
  // security-relevant write that should not wait behind another tenant's.
  concurrency: 8,
})
export class ScopeFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(ScopeFanoutProcessor.name);

  constructor(private readonly writer: ScopeWriterService) {
    super();
  }

  async process(job: Job<DocumentScopeChangedEvent>): Promise<void> {
    if (job.name !== SCOPE_FANOUT_JOB_NAME) {
      this.logger.warn(`Ignoring unknown job '${job.name}' on this queue`);
      return;
    }

    const event = job.data;
    const scope = {
      isOrganizationWide: event.isOrganizationWide,
      departmentIds: event.departmentIds,
      isDeleted: event.isDeleted,
    };

    // The SAME ordering the endpoint used. Re-deriving it from `restricting`
    // rather than hardcoding one order keeps the reconciler honest: a retry of
    // a restriction must not be the moment the system briefly widens access
    // again.
    if (event.restricting) {
      await this.writer.writeQdrant(event.documentId, scope, { fatal: true });
      await this.writer.writeChunks(event.documentId, scope);
    } else {
      await this.writer.writeChunks(event.documentId, scope);
      await this.writer.writeQdrant(event.documentId, scope, { fatal: true });
    }

    // `fatal: true` on BOTH paths here, unlike the endpoint: a throw is what
    // makes BullMQ retry, and there is no user waiting for a response to
    // protect. The grant that is merely deferred at the endpoint must
    // eventually land, and this is what lands it.
    const drift = await this.writer.findScopeDrift(event.documentId);
    if (drift.length > 0) {
      // Reachable when a chunk row was written between the two stores — an
      // ingestion job finishing mid-rescope. Throwing schedules a retry, which
      // is the only thing that converges it.
      throw new Error(
        `${drift.length} chunk row(s) of ${event.documentId} still disagree with their document`,
      );
    }
  }
}

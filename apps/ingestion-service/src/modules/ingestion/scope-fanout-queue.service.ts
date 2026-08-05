import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  DocumentScopeChangedEvent,
  formatErrorMsg,
  SCOPE_FANOUT_JOB_NAME,
  SCOPE_FANOUT_QUEUE,
} from '@synapsedesk/common';

/**
 * Queues the reconciler.
 *
 * Never throws: the endpoint has already applied the change to both
 * retrievable stores, so a queueing failure costs the RETRY, not the change.
 * Failing the request here would roll nothing back — the writes are already
 * committed — and would tell the admin their restriction failed when it did
 * not.
 */
@Injectable()
export class ScopeFanoutQueueService {
  private readonly logger = new Logger(ScopeFanoutQueueService.name);

  constructor(@InjectQueue(SCOPE_FANOUT_QUEUE) private readonly queue: Queue) {}

  async enqueue(event: DocumentScopeChangedEvent): Promise<void> {
    try {
      await this.queue.add(SCOPE_FANOUT_JOB_NAME, event, {
        // Keyed on document + timestamp rather than document alone: two scope
        // changes to one document are two jobs, and collapsing them on
        // document id would drop the SECOND — leaving the stores holding the
        // first change's scope while `documents` holds the second's.
        //
        // **Epoch millis, not the ISO string, and NOT separated by a colon.**
        // BullMQ rejects a custom id containing `:` — it is the delimiter in
        // its own Redis keys — and an ISO timestamp is full of them. That
        // rejection is thrown from `add()`, which this method swallows, so the
        // symptom was every reconciliation silently never being queued while
        // the endpoint reported success. Caught by the test below rather than
        // by the log nobody was reading.
        jobId: `${event.documentId}-${Date.parse(event.occurredAt)}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 200,
        removeOnFail: 1_000,
      });
    } catch (error) {
      this.logger.error(
        `Could not queue the scope reconciler for ${event.documentId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

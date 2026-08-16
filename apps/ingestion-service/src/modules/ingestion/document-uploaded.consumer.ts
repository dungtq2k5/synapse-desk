import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  DOCUMENT_PATTERNS,
  DocumentUploadedEvent,
  formatErrorMsg,
} from '@synapsedesk/common';
import { IngestionQueueService } from './ingestion-queue.service';

/**
 * `document.uploaded` → a queued ingestion job.
 *
 * NATS carries the trigger and BullMQ carries the WORK, which looks like one
 * queue too many until you ask what happens to a job that fails. NATS core is
 * at-most-once with no retry, no backoff and no dead letter; BullMQ has all
 * three. Publishing to NATS and immediately handing off to BullMQ means the
 * announcement stays a broadcast that anything may listen to, while the
 * processing gets the retry semantics a multi-minute job needs.
 *
 * Never rethrows, like every other consumer here: a throw on a malformed
 * payload is a poison message that buries every good event behind it.
 */
@Controller()
export class DocumentUploadedConsumer {
  private readonly logger = new Logger(DocumentUploadedConsumer.name);

  constructor(private readonly queue: IngestionQueueService) {}

  @EventPattern(DOCUMENT_PATTERNS.uploaded)
  async handle(@Payload() event: DocumentUploadedEvent): Promise<void> {
    if (!event?.documentId || !event.ingestionJobId || !event.objectPath) {
      this.logger.error(
        `${DOCUMENT_PATTERNS.uploaded} arrived incomplete; dropping it`,
      );
      return;
    }

    try {
      await this.queue.enqueue({
        organizationId: event.organizationId,
        documentId: event.documentId,
        ingestionJobId: event.ingestionJobId,
        objectPath: event.objectPath,
        fileType: event.fileType,
        // Carried one more hop: event -> job payload -> parser. The worker
        // reads no document row before parsing, so this is the only route the
        // language has.
        ocrLanguages: event.ocrLanguages,
      });
    } catch (error) {
      // The job ROW already exists and still reads QUEUED, so the document is
      // recoverable by a re-drain rather than lost. Logged loudly because
      // nothing else will notice: from the outside this looks exactly like a
      // document waiting its turn.
      this.logger.error(
        `Could not queue ingestion for ${event.documentId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

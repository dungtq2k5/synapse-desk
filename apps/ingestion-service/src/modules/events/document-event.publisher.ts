import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  DocumentDomainEvent,
  formatErrorMsg,
  NATS_CLIENT,
} from '@synapsedesk/common';

/**
 * Publishes Domain C's document events.
 *
 * Fire-and-forget, exactly like `TicketEventPublisher` and `AuditPublisher`: a
 * document that was confirmed is confirmed whether or not the broker was
 * reachable to say so. Failing the write because the announcement failed would
 * trade a durable fact for a transient one.
 *
 * The inherited trade-off: NATS core is at-most-once, so an event CAN be lost
 * while the broker is down — and here that means an ingestion job that never
 * starts. That is recoverable and visible (`ingestion_jobs` stays QUEUED, and
 * `POST /documents/:id/reindex` re-triggers it) rather than silent, which is
 * what makes at-most-once acceptable for this stream too.
 */
@Injectable()
export class DocumentEventPublisher {
  private readonly logger = new Logger(DocumentEventPublisher.name);

  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  /**
   * Takes the WHOLE event, pattern included, so the discriminated union does
   * its job: publishing an `indexed` event with a `reason` is a compile error.
   * Split into `(pattern, payload)` the two would only be correlated by
   * convention.
   */
  publish(event: DocumentDomainEvent): void {
    // `emit()` returns a COLD observable — nothing is published until something
    // subscribes. Omitting `.subscribe()` is the classic silent failure with
    // this API: no error, no message, no clue.
    this.client.emit(event.pattern, event).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish ${event.pattern} for document ${event.documentId}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}

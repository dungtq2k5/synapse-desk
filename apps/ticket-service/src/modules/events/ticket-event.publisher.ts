import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  formatErrorMsg,
  NATS_CLIENT,
  TicketDomainEvent,
} from '@synapsedesk/common';

/**
 * Publishes Domain B's domain events.
 *
 * Fire-and-forget, exactly like `AuditPublisher` and `NotificationPublisher`
 * before it — and for the same reason: a ticket that was created is created,
 * whether or not the broker was reachable to say so. Failing the write because
 * the announcement failed would trade a durable fact for a transient one.
 *
 * The trade-off is explicit and inherited from those two: NATS core is
 * at-most-once, so events CAN be lost while the broker is down. Everything
 * downstream is a projection or a notification, both of which tolerate a hole;
 * nothing reconstructs state from this stream. If something ever needs to,
 * JetStream plus a durable consumer is the upgrade — to both ends, not to this
 * one.
 */
@Injectable()
export class TicketEventPublisher {
  private readonly logger = new Logger(TicketEventPublisher.name);

  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  /**
   * Takes the WHOLE event, pattern included, rather than `(pattern, payload)`.
   *
   * That is what makes the discriminated union do its job: TypeScript checks
   * the payload against the pattern in the same object, so publishing a
   * `created` event with an `assignedToId` is a compile error. Split into two
   * arguments, the two would only be correlated by convention.
   */
  publish(event: TicketDomainEvent): void {
    // `emit()` returns a COLD observable — nothing is published until something
    // subscribes. Omitting the `.subscribe()` is the classic silent failure
    // with this API: no error, no message, no clue.
    this.client.emit(event.pattern, event).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish ${event.pattern} for ticket ${event.ticketId}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}

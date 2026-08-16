import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  EMAIL_INBOUND_PATTERNS,
  formatErrorMsg,
  NATS_CLIENT,
  type InboundEmailRejectedEvent,
} from '@synapsedesk/common';

/**
 * Tells notification-service that mail was refused
 *
 * **The gateway's first NATS PUBLISHER**, which is worth naming: it has
 * consumed events since the realtime work and has never emitted one, so the client is new
 * rather than a channel that happened to exist.
 *
 * **Fire-and-forget, and it must never throw.** The webhook answers 200 for
 * every deliberate outcome, so the drop path cannot be allowed to fail because
 * a broker was briefly unreachable — a rejection that fails to publish costs
 * one unsent courtesy reply, while an exception here would turn a drop into a
 * 5xx and make the provider redeliver mail this system has already refused.
 */
@Injectable()
export class InboundEmailPublisher {
  private readonly logger = new Logger(InboundEmailPublisher.name);

  constructor(@Inject(NATS_CLIENT) private readonly nats: ClientProxy) {}

  rejected(
    event: Omit<InboundEmailRejectedEvent, 'pattern' | 'occurredAt'>,
  ): void {
    const payload: InboundEmailRejectedEvent = {
      pattern: EMAIL_INBOUND_PATTERNS.rejected,
      occurredAt: new Date().toISOString(),
      ...event,
    };

    // `emit` returns a COLD observable — nothing is sent until something
    // subscribes. The same trap `TicketEventPublisher` documents, and the
    // reason this is a `subscribe` rather than a bare call.
    this.nats.emit(EMAIL_INBOUND_PATTERNS.rejected, payload).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Could not publish an inbound rejection: ${formatErrorMsg(error)}`,
        ),
    });
  }
}

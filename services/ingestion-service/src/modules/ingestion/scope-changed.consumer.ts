import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  DOCUMENT_PATTERNS,
  DocumentScopeChangedEvent,
} from '@synapsedesk/common';
import { ScopeFanoutQueueService } from './scope-fanout-queue.service';

/**
 * `document.scope_changed` → a queued RECONCILIATION.
 *
 * The event is a broadcast anything may listen to; the retry semantics live in
 * BullMQ. NATS core is at-most-once with no retry, no backoff and no dead
 * letter — fine for an announcement, wrong for a write that must eventually
 * land.
 *
 * Never rethrows. A throw here poisons the subject and buries every LATER
 * scope change behind it, which would mean subsequent restrictions silently
 * stop applying — the exact failure this subsystem exists to prevent, arriving
 * through the error handler.
 */
@Controller()
export class ScopeChangedConsumer {
  private readonly logger = new Logger(ScopeChangedConsumer.name);

  constructor(private readonly queue: ScopeFanoutQueueService) {}

  @EventPattern(DOCUMENT_PATTERNS.scopeChanged)
  async handle(@Payload() event: DocumentScopeChangedEvent): Promise<void> {
    if (!event?.documentId) {
      this.logger.error(
        `${DOCUMENT_PATTERNS.scopeChanged} arrived with no documentId`,
      );
      return;
    }

    await this.queue.enqueue(event);
  }
}

import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  BILLING_PATTERNS,
  EntitlementsChangedEvent,
} from '@synapsedesk/common';
import { AiSettingsService } from './ai-settings.service';

/**
 * Invalidates one tenant's cached AI settings when their plan changes.
 *
 * **The publisher is the Stripe webhook**, and this
 * consumer still ships now, because of the failure mode of
 * shipping the cache first: a downgraded tenant keeps receiving the premium
 * model until the TTL expires. Nobody reports that — it fails in the direction
 * that costs money rather than the direction a customer notices — so the fix
 * has to be in place before the cache is, not after somebody spots it.
 *
 * Never rethrows, following `DeleteConsumer` and `AuditConsumer`: a throw on a
 * malformed payload does not fail safely, it produces a poison message that
 * buries every good event behind it. A missed invalidation costs one TTL of
 * stale settings; a poisoned subject costs every subsequent invalidation.
 */
@Controller()
export class EntitlementsConsumer {
  private readonly logger = new Logger(EntitlementsConsumer.name);

  constructor(private readonly aiSettings: AiSettingsService) {}

  @EventPattern(BILLING_PATTERNS.entitlementsChanged)
  handle(@Payload() event: EntitlementsChangedEvent): void {
    // A missing organizationId cannot be interpreted as "all of them". That
    // reading turns one malformed message into a full cache flush and a
    // re-resolve for every active tenant at once — the thundering herd
    // The thundering herd this exists to prevent, arriving from the one input nobody
    // validated.
    if (!event?.organizationId) {
      this.logger.error(
        `${BILLING_PATTERNS.entitlementsChanged} arrived with no organizationId`,
      );
      return;
    }

    this.aiSettings.invalidate(event.organizationId);
  }
}

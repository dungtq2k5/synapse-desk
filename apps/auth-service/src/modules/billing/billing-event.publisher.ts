import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BILLING_PATTERNS,
  EntitlementsChangedEvent,
  formatErrorMsg,
  NATS_CLIENT,
} from '@synapsedesk/common';

/**
 * Announces that a tenant's entitlements changed.
 *
 * **The consumer already exists** — `ingestion-service` invalidates its cached
 * AI settings on this subject (doc 15 §1.3). Without the emit, a downgraded
 * tenant keeps receiving the premium model for the length of the cache TTL:
 * the system giving away the exact thing it just stopped being paid for, in the
 * direction that costs money rather than the direction someone complains about.
 *
 * Fire-and-forget, like every other publisher here. The entitlement write is
 * already committed, so a failed emit costs one TTL of stale settings — while
 * failing the webhook would tell Stripe to retry an event that was fully
 * applied.
 */
@Injectable()
export class BillingEventPublisher {
  private readonly logger = new Logger(BillingEventPublisher.name);

  constructor(@Inject(NATS_CLIENT) private readonly nats: ClientProxy) {}

  publishEntitlementsChanged(organizationId: string): void {
    const event: EntitlementsChangedEvent = {
      pattern: BILLING_PATTERNS.entitlementsChanged,
      organizationId,
      occurredAt: new Date().toISOString(),
    };

    // `.subscribe()` is mandatory: `emit()` returns a COLD observable and
    // nothing is published until something subscribes. Omitting it is the
    // classic silent failure with this API — no error, no message, no clue.
    this.nats.emit(BILLING_PATTERNS.entitlementsChanged, event).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish entitlements_changed for ${organizationId}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}

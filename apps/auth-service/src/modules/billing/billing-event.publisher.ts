import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BILLING_PATTERNS,
  EntitlementsChangedEvent,
  formatErrorMsg,
  NATS_CLIENT,
} from '@synapsedesk/common';

/**
 * Publishes `billing.entitlements_changed` once a tenant's entitlements are written.
 *
 * Fire-and-forget: a failed emit is logged, never thrown, and costs one cache
 * TTL of stale AI settings. Call it after the entitlement write has committed.
 *
 * `ingestion-service` consumes this subject to invalidate its cached AI
 * settings — see `docs/decisions/0007-settings-layer-owns-model-names.md`.
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
    //
    // Log, never rethrow: this runs inside the Stripe webhook, and a throw
    // would make Stripe retry an event that was already fully applied.
    this.nats.emit(BILLING_PATTERNS.entitlementsChanged, event).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish entitlements_changed for ${organizationId}: ${formatErrorMsg(error)}`,
        ),
    });
  }
}

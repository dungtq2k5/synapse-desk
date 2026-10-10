import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BILLING_PATTERNS,
  EntitlementsChangedEvent,
  formatErrorMsg,
  NATS_CLIENT,
  CreateInAppNotificationCommand,
  IN_APP_NOTIFICATION_PATTERN,
  JetStreamPublisher,
  NOTIFICATION_TYPES,
  NotificationPriority,
  NotificationResourceType,
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

  constructor(
    @Inject(NATS_CLIENT) private readonly nats: ClientProxy,
    private readonly jetstream: JetStreamPublisher,
  ) {}

  /**
   * @param changeId identifies the CHANGE, not the moment of publishing — the
   * Stripe event id on the webhook path, the plan's `updatedAt` on an apply.
   * Absent means "nothing to derive from", and no tenant notice is sent.
   */
  publishEntitlementsChanged(organizationId: string, changeId?: string): void {
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

    // Only when the caller can name the change. A renewal that moved no grant
    // has nothing to announce, and `entitlements_changed` above still fires for
    // the consumers that refresh caches on every write.
    if (changeId) {
      this.notifyPlanChanged(organizationId, changeId, event.occurredAt);
    }
  }

  /**
   * Tells the tenant their plan changed.
   *
   * **One notification PER TENANT, and the framing is what makes that safe.**
   * A plan apply writes every subscriber at once, so a fan-out over 200 tenants
   * publishes 200 of these — which is correct, because each is a different
   * recipient set. What it must not read as is 200 copies of one announcement,
   * so the wording is "your plan was updated" rather than "you upgraded": the
   * tenant did not necessarily do anything.
   *
   * **And it must not be deduped onto the plan.** An event id keyed on the plan
   * would collapse the fan-out to a single notification that only the first
   * tenant receives — so the id carries the ORGANIZATION as well as the change.
   *
   * **`changeId`, not a timestamp taken here.** An id minted at publish time is
   * generated rather than derived, which is the thing the level alarm's own
   * docblock forbids one file away: a retried apply or a redelivered webhook
   * would mint a second id for one logical change, and neither the stream's
   * window nor the durable constraint would have anything to collapse on.
   */
  private notifyPlanChanged(
    organizationId: string,
    changeId: string,
    occurredAt: string,
  ): void {
    try {
      const eventId = `plan-changed:${organizationId}:${changeId}`;

      const command: CreateInAppNotificationCommand = {
        organizationId,
        type: NOTIFICATION_TYPES.planChanged,
        audience: { kind: 'permission', permission: 'organization.update' },
        eventId,
        title: 'Your plan was updated',
        body: 'The limits on your workspace have changed. You can see what your plan now includes on the billing page.',
        priority: NotificationPriority.NORMAL,
        occurredAt,
        resourceType: NotificationResourceType.ORGANIZATION,
        resourceId: organizationId,
        actionUrl: '/settings/billing',
      };

      this.jetstream.publish(IN_APP_NOTIFICATION_PATTERN, command, eventId);
    } catch (error) {
      // Same rule as above: this runs inside the Stripe webhook and inside the
      // plan apply, and neither may fail because a notice could not be sent.
      this.logger.error(
        `Failed to publish the plan-changed notice for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

/** @file What the webhook management routes return. */

import type {
  NotificationType,
  WebhookDeliveryStatus,
} from '@synapsedesk/common';

export class WebhookEndpointResponseDto {
  readonly id!: string;
  readonly url!: string;
  readonly description!: string | null;
  /**
   * The `NotificationType` vocabulary (`ticket.assigned`) — the public event
   * names, never the internal transport subjects. **Never empty**: an empty
   * list never means "all", and zero subscriptions is refused at creation.
   */
  readonly eventTypes!: NotificationType[];
  readonly isActive!: boolean;
  /**
   * Why WE disabled it (auto-disable after sustained failure). NULL when the
   * tenant disabled it themselves — the distinction a settings page renders.
   */
  readonly disabledReason!: string | null;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

/**
 * Create and rotate only — **the secret is shown once.**
 *
 * The plain endpoint response has no secret field at all, structurally, so a
 * listing cannot leak the signing key by mapper mistake.
 */
export class WebhookEndpointWithSecretResponseDto {
  readonly endpoint!: WebhookEndpointResponseDto;
  /** `whsec_…` — store it now; no read returns it again. */
  readonly secret!: string;
}

export class TestWebhookResponseDto {
  readonly delivered!: boolean;
  readonly responseStatus!: number | null;
  readonly error!: string | null;
}

export class WebhookDeliveryResponseDto {
  readonly id!: string;
  /** The payload `id` the receiver deduplicates on — stable across retries. */
  readonly eventId!: string;
  // `string`, DELIBERATELY not `NotificationType` — a delivery row is
  // HISTORY, and may carry vocabulary a later build has retired. The union
  // would force the mapper to lie (a cast) or erase the fact (null); keeping
  // the string is how it stays visible. The honest consequence: a client
  // switching on this needs a default arm.
  readonly eventType!: string;
  /** `null` for a wire value this build does not know — never invented. */
  readonly status!: WebhookDeliveryStatus | null;
  readonly attempts!: number;
  readonly responseStatus!: number | null;
  readonly lastError!: string | null;
  /** When the EVENT occurred — not when any attempt was made. */
  readonly occurredAt!: Date;
  readonly deliveredAt!: Date | null;
}

export class WebhookDeliveriesResponseDto {
  readonly items!: WebhookDeliveryResponseDto[];
}

/** The catalogue — what an endpoint can subscribe to, today's vocabulary. */
export class WebhookEventTypesResponseDto {
  readonly types!: NotificationType[];
}

export class DeleteWebhookEndpointResponseDto {
  readonly deleted!: boolean;
}

export class WebhookEndpointsResponseDto {
  readonly items!: WebhookEndpointResponseDto[];
}

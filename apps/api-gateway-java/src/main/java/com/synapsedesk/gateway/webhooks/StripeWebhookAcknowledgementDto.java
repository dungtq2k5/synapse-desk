package com.synapsedesk.gateway.webhooks;

import jakarta.validation.constraints.NotNull;

/**
 * `{ received: true, status: string }` — `webhooks.controller.ts`'s
 * `Promise<{ received: true; status: string }>`, named rather than left as
 * {@code ApiResponse<Object>}. `status` is {@code BillingEventStatus}
 * as a string (empty when the event type is one this system does not act
 * on), the same reasoning `billing.proto` gives for carrying it as a string
 * rather than an enum.
 */
public record StripeWebhookAcknowledgementDto(
  @NotNull boolean received,
  @NotNull String status
) {}

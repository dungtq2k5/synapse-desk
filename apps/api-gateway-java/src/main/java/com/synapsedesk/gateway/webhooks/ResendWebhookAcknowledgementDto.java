package com.synapsedesk.gateway.webhooks;

import jakarta.validation.constraints.NotNull;

/**
 * `{ received: true, outcome: string }` — `resend-inbound.service.ts`'s
 * {@code ResendWebhookAck} type, named rather than left as {@code
 * ApiResponse<Object>}. `outcome` is the value of the
 * `inbound_email_webhook_total` label: one of the webhook's own exits
 * (`ignored_event`, `fetch_failed`, `invalid_payload`) or an {@code
 * InboundOutcome}. A string, because the published contract types it as one.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 */
public record ResendWebhookAcknowledgementDto(
  @NotNull boolean received,
  @NotNull String outcome
) {}

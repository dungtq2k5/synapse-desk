package com.synapsedesk.gateway.webhooks;

/**
 * `{ received: true, outcome: string }` — `resend-inbound.service.ts`'s
 * {@code ResendWebhookAck} type, named rather than left as {@code
 * ApiResponse<Object>}. `outcome` labels the `inbound_email_webhook_total`
 * metric (`ignored_event`, and the others that type's own table names) —
 * a string because the set is Node's own {@code InboundOutcome}, not this
 * port's to re-declare as an enum ahead of the `accept()` pipeline this
 * pass does not yet carry.
 */
public record ResendWebhookAcknowledgementDto(
  boolean received,
  String outcome
) {}

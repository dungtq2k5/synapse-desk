package com.synapsedesk.gateway.web;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The {@code type} filter of the notifications list, exactly as the published
 * contract's enum lists it. The wire values are dotted ({@code ticket.assigned}),
 * which cannot be constant names, so each constant carries its wire value;
 * {@link EnumParameterConverters} converts by it, and {@code @JsonValue} is what
 * makes the document publish the dotted values and not the constant names.
 */
public enum NotificationTypeFilter {
  BILLING_PAYMENT_FAILED("billing.payment_failed"),
  BILLING_PLAN_CHANGED("billing.plan_changed"),
  LIMIT_THRESHOLD("limit.threshold"),
  QUOTA_THRESHOLD("quota.threshold"),
  TICKET_ASSIGNED("ticket.assigned"),
  TICKET_ESCALATED("ticket.escalated"),
  TICKET_MESSAGE_CREATED("ticket.message_created"),
  TICKET_REASSIGNED("ticket.reassigned"),
  TICKET_STATUS_CHANGED("ticket.status_changed"),
  WEBHOOK_ENDPOINT_DISABLED("webhook.endpoint_disabled");

  private final String wire;

  NotificationTypeFilter(String wire) {
    this.wire = wire;
  }

  @JsonValue
  public String wire() {
    return wire;
  }
}

package com.synapsedesk.gateway.inbound;

/**
 * Why a message did not become a ticket, or what it became; each constant's
 * wire spelling is its own name.
 *
 * <p><b>Every one of these is answered with a 200.</b> A 4xx tells the provider
 * the request was malformed and worth retrying, so one misconfigured mail rule
 * would become a retry loop against the webhook. The outcome travels in the
 * response body and the {@code inbound_email_webhook_total} label instead, where
 * an operator can see it and a provider cannot act on it.
 */
public enum InboundOutcome {
  TICKET_CREATED("TICKET_CREATED"),
  MESSAGE_APPENDED("MESSAGE_APPENDED"),
  DUPLICATE("DUPLICATE"),
  UNROUTABLE_ADDRESS("UNROUTABLE_ADDRESS"),
  /** A real tenant, but not one currently accepting anything. */
  TENANT_INACTIVE("TENANT_INACTIVE"),
  SENDER_NOT_PERMITTED("SENDER_NOT_PERMITTED"),
  /** Our own notification came back to us. */
  SELF_ADDRESSED("SELF_ADDRESSED");

  private final String wire;

  InboundOutcome(String wire) {
    this.wire = wire;
  }

  /** The spelling on the wire and in the metric label. */
  public String wire() {
    return wire;
  }
}

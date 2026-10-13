package com.synapsedesk.gateway.common.nats;

import java.nio.charset.StandardCharsets;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The Nest {@code ClientProxy.emit(pattern, event)} envelope, unwrapped by
 * hand — every domain-event publisher (ticket-service,
 * ingestion-service, auth-service, notification-service) calls this,
 * putting the message on the wire as {@code {"pattern": "<subject>", "data":
 * <event>}}. Nest's own deserializer unwraps it for {@code .data} on that
 * side; a jnats subscriber receives the raw bytes with no such unwrapping.
 *
 * <p>Extracted here because {@code CacheInvalidationConsumer} was the first
 * of what is now four NATS consumers needing this exact check — the same
 * "one copy is fine, four is the shape that drifts" lesson the four
 * {@code requireIsoDate} copies left behind. A top-level {@code pattern} OR
 * {@code data} key means the payload is that envelope and the real event is
 * {@code .data}; anything else is the event itself, unwrapped.
 */
public final class NatsEnvelope {

  private NatsEnvelope() {}

  /** The event payload, unwrapped if it arrived inside a Nest envelope. Never throws. */
  public static JsonNode unwrap(ObjectMapper json, byte[] payload) {
    JsonNode root;
    try {
      root = json.readTree(new String(payload, StandardCharsets.UTF_8));
    } catch (RuntimeException malformed) {
      return null;
    }

    return root.get("pattern") != null || root.get("data") != null
      ? root.get("data")
      : root;
  }

  /** {@code event.organizationId}, or {@code null} if absent, blank, or the event itself is null. */
  public static String organizationIdOf(JsonNode event) {
    return stringField(event, "organizationId");
  }

  /** One string field off the unwrapped event, or {@code null} if absent, blank, or not a string. */
  public static String stringField(JsonNode event, String field) {
    if (event == null) {
      return null;
    }
    JsonNode value = event.get(field);
    if (value == null || !value.isString()) {
      return null;
    }
    String text = value.asString();
    return text.isEmpty() ? null : text;
  }
}

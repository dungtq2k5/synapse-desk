package com.synapsedesk.gateway.modules.realtime;

/** `TypingPayloadDto` — the `REALTIME_EVENTS.typing` frame's data. */
public record TypingPayload(
  String ticketId,
  String userId,
  boolean isTyping,
  long ttlMs
) {}

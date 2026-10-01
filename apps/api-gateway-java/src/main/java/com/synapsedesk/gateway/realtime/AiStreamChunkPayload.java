package com.synapsedesk.gateway.realtime;

/** `ai:stream:chunk` — one token, to the requesting socket alone. */
public record AiStreamChunkPayload(
  String streamId,
  String ticketId,
  String token
) {}

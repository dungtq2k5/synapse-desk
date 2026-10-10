package com.synapsedesk.gateway.realtime;

import java.util.List;

/**
 * `ai:stream:done` — {@code messageId} is {@code null} on the escalation
 * path, where the answer was never persisted.
 */
public record AiStreamDonePayload(
  String streamId,
  String ticketId,
  String messageId,
  String content,
  List<CitationPayload> citations,
  boolean escalated,
  String status
) {}

package com.synapsedesk.gateway.modules.realtime;

import java.util.List;

/**
 * `MessageSendDto` — the {@code message:send} payload. {@code
 * clientMessageId} is REQUIRED, unlike its HTTP twin: a socket that
 * reconnects holding an unacked message re-emits it, and without an id to
 * dedup on it double-posts.
 */
public record MessageSendBody(
  String ticketId,
  String content,
  String clientMessageId,
  Boolean isInternalNote,
  Boolean invokeAi,
  List<NewAttachmentBody> attachments
) {}

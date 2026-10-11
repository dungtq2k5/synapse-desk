package com.synapsedesk.gateway.modules.realtime;

import java.util.List;

/** The {@code message:send} ack's data — never the created message itself. */
public record MessageSendAck(
  String messageId,
  String streamId,
  List<String> skippedAttachments
) {}

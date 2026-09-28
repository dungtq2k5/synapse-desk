package com.synapsedesk.gateway.realtime;

import java.util.List;

/** `ai:stream:attachments-skipped` — file NAMES only, never contents. */
public record AiStreamAttachmentsSkippedPayload(
  String ticketId,
  List<String> fileNames
) {}

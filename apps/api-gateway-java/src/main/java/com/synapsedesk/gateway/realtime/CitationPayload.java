package com.synapsedesk.gateway.realtime;

/** `CitationResponseDto` — the same shape `GET .../messages` serves. */
public record CitationPayload(
  String chunkId,
  String documentId,
  String documentTitle,
  Integer pageNumber,
  String vectorPointId
) {}

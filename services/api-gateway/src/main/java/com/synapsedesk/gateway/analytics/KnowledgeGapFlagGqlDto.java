package com.synapsedesk.gateway.analytics;

/** `KnowledgeGapFlag` — no `document` resolved here; the edge loads it on demand. */
public record KnowledgeGapFlagGqlDto(
  String documentId,
  String documentTitle,
  String flagType,
  String detail
) {}

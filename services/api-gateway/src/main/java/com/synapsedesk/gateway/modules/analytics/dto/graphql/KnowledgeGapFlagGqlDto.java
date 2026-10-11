package com.synapsedesk.gateway.modules.analytics.dto.graphql;

/** `KnowledgeGapFlag` — no `document` resolved here; the edge loads it on demand. */
public record KnowledgeGapFlagGqlDto(
  String documentId,
  String documentTitle,
  String flagType,
  String detail
) {}

package com.synapsedesk.gateway.modules.analytics.dto.graphql;

/** `DocumentUsage` — no `document` resolved here; the edge loads it on demand. */
public record DocumentUsageGqlDto(
  String documentId,
  String title,
  int retrievalCount,
  int citationCount,
  int chunkCount
) {}

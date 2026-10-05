package com.synapsedesk.gateway.analytics;

import java.util.List;

/** `KnowledgeGaps` — `Query.analyticsKnowledgeGaps`'s return type. */
public record KnowledgeGapsGqlDto(
  int answeringGenerations,
  int attachmentEmptyRetrievals,
  RateGqlDto attachmentGroundedRate,
  String dataThrough,
  RateGqlDto emptyRetrievalRate,
  int emptyRetrievals,
  List<KnowledgeGapFlagGqlDto> flags,
  List<UnavailableBlockGqlDto> unavailable
) {}

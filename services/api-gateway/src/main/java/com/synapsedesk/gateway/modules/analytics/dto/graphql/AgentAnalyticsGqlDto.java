package com.synapsedesk.gateway.modules.analytics.dto.graphql;

import java.util.List;

/** `AgentAnalytics` — `Query.analyticsAgents`'s return type. */
public record AgentAnalyticsGqlDto(
  List<AgentStatGqlDto> items,
  List<UnavailableBlockGqlDto> unavailable,
  String dataThrough
) {}

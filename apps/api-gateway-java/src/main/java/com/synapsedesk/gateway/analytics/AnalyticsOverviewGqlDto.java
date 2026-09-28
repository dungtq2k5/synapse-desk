package com.synapsedesk.gateway.analytics;

import java.time.OffsetDateTime;

/** `AnalyticsOverview` — the headline figures for a date range. */
public record AnalyticsOverviewGqlDto(
  int ticketsCreated,
  int ticketsResolved,
  int ticketsEscalated,
  int openTickets,
  RateGqlDto deflection,
  RateGqlDto csat,
  MeanGqlDto humanFirstResponseSeconds,
  MeanGqlDto aiFirstResponseSeconds,
  MeanGqlDto resolutionSeconds,
  Double openTicketMedianAgeSeconds,
  OffsetDateTime computedAt,
  String dataThrough
) {}

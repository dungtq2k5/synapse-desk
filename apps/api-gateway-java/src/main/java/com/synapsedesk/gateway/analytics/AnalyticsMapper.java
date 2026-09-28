package com.synapsedesk.gateway.analytics;

import com.google.protobuf.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.ingestion.Ledger.AiMeanValue;
import synapsedesk.ingestion.Ledger.AiRateValue;
import synapsedesk.ingestion.Ledger.DocumentUsageStat;
import synapsedesk.ticket.Analytics.AgentStat;
import synapsedesk.ticket.Analytics.MeanValue;
import synapsedesk.ticket.Analytics.OverviewResponse;
import synapsedesk.ticket.Analytics.RateValue;

/**
 * Wire -> the GraphQL analytics DTOs — `analytics.mapper.ts`'s
 * `toRateResponseDto`/`toMeanResponseDto`, reproduced. No name hydration:
 * {@link AgentStatGqlDto} carries only `agentId`, matching Node's own
 * `hydrateNames: false` leg for this transport.
 */
public final class AnalyticsMapper {

  private AnalyticsMapper() {}

  public static RateGqlDto toRateGqlDto(RateValue value) {
    return new RateGqlDto(
      value.hasRate() ? value.getRate() : null,
      value.getNumerator(),
      value.getDenominator()
    );
  }

  public static RateGqlDto toRateGqlDto(AiRateValue value) {
    return new RateGqlDto(
      value.hasRate() ? value.getRate() : null,
      value.getNumerator(),
      value.getDenominator()
    );
  }

  public static MeanGqlDto toMeanGqlDto(MeanValue value) {
    return new MeanGqlDto(
      value.hasMean() ? value.getMean() : null,
      value.getCount()
    );
  }

  public static MeanGqlDto toMeanGqlDto(AiMeanValue value) {
    return new MeanGqlDto(
      value.hasMean() ? value.getMean() : null,
      value.getCount()
    );
  }

  public static RateGqlDto emptyRate() {
    return new RateGqlDto(null, 0, 0);
  }

  public static AnalyticsOverviewGqlDto toOverviewGqlDto(
    OverviewResponse response
  ) {
    return new AnalyticsOverviewGqlDto(
      response.getTicketsCreated(),
      response.getTicketsResolved(),
      response.getTicketsEscalated(),
      response.getOpenTickets(),
      toRateGqlDto(response.getDeflection()),
      toRateGqlDto(response.getCsat()),
      toMeanGqlDto(response.getHumanFirstResponseSeconds()),
      toMeanGqlDto(response.getAiFirstResponseSeconds()),
      toMeanGqlDto(response.getResolutionSeconds()),
      response.hasOpenTicketMedianAgeSeconds()
        ? (double) response.getOpenTicketMedianAgeSeconds()
        : null,
      response.hasComputedAt()
        ? toOffsetDateTime(response.getComputedAt())
        : null,
      response.hasDataThrough() ? response.getDataThrough() : null
    );
  }

  public static AgentStatGqlDto toAgentStatGqlDto(
    AgentStat row,
    AiRateValue draftAcceptance
  ) {
    return new AgentStatGqlDto(
      row.getAgentId(),
      row.getAssigned(),
      row.getResolved(),
      row.getMessagesSent(),
      toMeanGqlDto(row.getResolutionSeconds()),
      draftAcceptance != null ? toRateGqlDto(draftAcceptance) : null
    );
  }

  public static DocumentUsageGqlDto toDocumentUsageGqlDto(
    DocumentUsageStat stat
  ) {
    return new DocumentUsageGqlDto(
      stat.getDocumentId(),
      stat.getTitle(),
      stat.getRetrievalCount(),
      stat.getCitationCount(),
      stat.getChunkCount()
    );
  }

  private static OffsetDateTime toOffsetDateTime(Timestamp timestamp) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}

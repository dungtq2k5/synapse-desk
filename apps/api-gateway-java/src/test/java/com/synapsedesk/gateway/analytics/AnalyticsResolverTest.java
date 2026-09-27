package com.synapsedesk.gateway.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.documents.DocumentGqlDto;
import com.synapsedesk.gateway.graphql.UserSummaryGqlDto;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.dataloader.DataLoader;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiUsageResponse;
import synapsedesk.ticket.Analytics.AgentStat;
import synapsedesk.ticket.Analytics.AgentStatsResponse;
import synapsedesk.ticket.Analytics.MeanValue;
import synapsedesk.ticket.Analytics.OverviewResponse;
import synapsedesk.ticket.Analytics.RateValue;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `Query.analyticsOverview`/`analyticsAgents`, and the partial-failure
 * property `agents` exists for: one leg down still returns the other leg's
 * numbers, with the failure named in `unavailable` rather than the whole
 * field erroring — and never a call to auth-service, matching
 * `hydrateNames: false`'s Java equivalent (simply no such leg).
 */
class AnalyticsResolverTest {

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsStub =
      mock(AnalyticsServiceGrpc.AnalyticsServiceBlockingStub.class);
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerStub =
      mock(AiLedgerServiceGrpc.AiLedgerServiceBlockingStub.class);
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final CacheService cache = mock(CacheService.class);
  private AnalyticsResolver resolver;

  private static RequestContext context() {
    return new RequestContext(
        "agent-1", "11111111-1111-4111-8111-111111111111", false, List.of(), List.of("analytics.read"), true,
        "127.0.0.1", "test");
  }

  @BeforeEach
  void setUp() {
    when(analyticsStub.withDeadlineAfter(anyLong(), any())).thenReturn(analyticsStub);
    when(analyticsStub.withInterceptors(any())).thenReturn(analyticsStub);
    when(ledgerStub.withDeadlineAfter(anyLong(), any())).thenReturn(ledgerStub);
    when(ledgerStub.withInterceptors(any())).thenReturn(ledgerStub);
    when(currentUser.require(any())).thenReturn(context());
    // The cache is a pass-through here: every test asserts the COMPUTATION,
    // not the caching, which `AnalyticsCacheRoundTripIT` already covers
    // against a real Redis.
    when(cache.buildKey(any(), any(), any())).thenReturn("key");
    when(cache.<Object>wrap(any(), anyLong(), any(), any()))
        .thenAnswer(invocation -> ((java.util.function.Supplier<?>) invocation.getArgument(3)).get());
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(mock(HttpServletRequest.class)));
    resolver = new AnalyticsResolver(analyticsStub, ledgerStub, currentUser, cache);
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void overviewMapsTheWireResponse() {
    when(analyticsStub.getOverview(any()))
        .thenReturn(
            OverviewResponse.newBuilder()
                .setTicketsCreated(10)
                .setTicketsResolved(8)
                .setTicketsEscalated(2)
                .setOpenTickets(3)
                .setDeflection(RateValue.newBuilder().setRate(0.4f).setNumerator(4).setDenominator(10).build())
                .setCsat(RateValue.newBuilder().setNumerator(0).setDenominator(0).build())
                .setHumanFirstResponseSeconds(MeanValue.newBuilder().setMean(30f).setCount(5).build())
                .setAiFirstResponseSeconds(MeanValue.newBuilder().setCount(0).build())
                .setResolutionSeconds(MeanValue.newBuilder().setMean(600f).setCount(5).build())
                .build());

    AnalyticsOverviewGqlDto result = resolver.analyticsOverview("2026-01-01", "2026-01-31");

    assertThat(result.ticketsCreated()).isEqualTo(10);
    assertThat(result.deflection().rate()).isEqualTo(0.4f, org.assertj.core.data.Offset.offset(0.0001));
    assertThat(result.csat().rate()).isNull();
    assertThat(result.aiFirstResponseSeconds().mean()).isNull();
  }

  @Test
  void agentsNeverCallsAuthServiceAndReturnsBothLegsWhenBothSucceed() {
    when(analyticsStub.getAgentStats(any()))
        .thenReturn(
            AgentStatsResponse.newBuilder()
                .addItems(
                    AgentStat.newBuilder()
                        .setAgentId("agent-1")
                        .setAssigned(5)
                        .setResolved(4)
                        .setMessagesSent(12)
                        .setResolutionSeconds(MeanValue.newBuilder().setMean(200f).setCount(4).build())
                        .build())
                .build());
    when(ledgerStub.getAiUsage(any()))
        .thenReturn(
            AiUsageResponse.newBuilder()
                .setDraftAcceptance(
                    synapsedesk.ingestion.Ledger.AiRateValue.newBuilder()
                        .setRate(0.75f)
                        .setNumerator(3)
                        .setDenominator(4)
                        .build())
                .build());

    AgentAnalyticsGqlDto result = resolver.analyticsAgents("2026-01-01", "2026-01-31");

    assertThat(result.items()).hasSize(1);
    assertThat(result.items().get(0).draftAcceptance().rate()).isEqualTo(0.75f, org.assertj.core.data.Offset.offset(0.0001));
    assertThat(result.unavailable()).isEmpty();
  }

  @Test
  void agentsMarksTheFailingLegUnavailableAndKeepsTheOther() {
    when(analyticsStub.getAgentStats(any()))
        .thenReturn(
            AgentStatsResponse.newBuilder()
                .addItems(
                    AgentStat.newBuilder()
                        .setAgentId("agent-1")
                        .setAssigned(5)
                        .setResolved(4)
                        .setMessagesSent(12)
                        .setResolutionSeconds(MeanValue.newBuilder().setMean(200f).setCount(4).build())
                        .build())
                .build());
    when(ledgerStub.getAiUsage(any()))
        .thenThrow(new StatusRuntimeException(Status.UNAVAILABLE.withDescription("ingestion-service is down")));

    AgentAnalyticsGqlDto result = resolver.analyticsAgents("2026-01-01", "2026-01-31");

    assertThat(result.items()).hasSize(1);
    assertThat(result.items().get(0).draftAcceptance()).isNull();
    assertThat(result.unavailable()).hasSize(1);
    assertThat(result.unavailable().get(0).source()).isEqualTo("ingestion-service");
  }

  @Test
  void agentEdgeLoadsThroughTheUsersLoader() {
    AgentStatGqlDto stat = new AgentStatGqlDto("agent-1", 5, 4, 12, new MeanGqlDto(200.0, 4), null);
    @SuppressWarnings("unchecked")
    DataLoader<String, UserSummaryGqlDto> loader = mock(DataLoader.class);
    when(loader.load(any(), any())).thenReturn(CompletableFuture.completedFuture(null));

    resolver.agent(stat, loader);

    verify(loader).load(org.mockito.ArgumentMatchers.eq("agent-1"), any());
  }

  @Test
  void documentUsageEdgeLoadsThroughTheDocumentsLoader() {
    DocumentUsageGqlDto usage = new DocumentUsageGqlDto("doc-1", "Handbook", 10, 3, 4);
    @SuppressWarnings("unchecked")
    DataLoader<String, DocumentGqlDto> loader = mock(DataLoader.class);
    when(loader.load(any(), any())).thenReturn(CompletableFuture.completedFuture(null));

    resolver.documentUsageDocument(usage, loader);

    verify(loader).load(org.mockito.ArgumentMatchers.eq("doc-1"), any());
  }

  @Test
  void knowledgeGapFlagEdgeLoadsThroughTheDocumentsLoader() {
    KnowledgeGapFlagGqlDto flag = new KnowledgeGapFlagGqlDto("doc-2", "Policy", "EMPTY_RETRIEVAL", "no hits");
    @SuppressWarnings("unchecked")
    DataLoader<String, DocumentGqlDto> loader = mock(DataLoader.class);
    when(loader.load(any(), any())).thenReturn(CompletableFuture.completedFuture(null));

    resolver.knowledgeGapFlagDocument(flag, loader);

    verify(loader).load(org.mockito.ArgumentMatchers.eq("doc-2"), any());
  }
}

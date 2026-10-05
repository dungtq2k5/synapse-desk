package com.synapsedesk.gateway.analytics;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.documents.DocumentGqlDto;
import com.synapsedesk.gateway.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiUsageRequest;
import synapsedesk.ingestion.Ledger.AiUsageResponse;
import synapsedesk.ingestion.Ledger.DocumentAnalyticsRequest;
import synapsedesk.ingestion.Ledger.DocumentAnalyticsResponse;
import synapsedesk.ingestion.Ledger.KnowledgeGapDocumentFlag;
import synapsedesk.ingestion.Ledger.KnowledgeGapsRequest;
import synapsedesk.ingestion.Ledger.KnowledgeGapsResponse;
import synapsedesk.ticket.Analytics.AgentStat;
import synapsedesk.ticket.Analytics.AgentStatsResponse;
import synapsedesk.ticket.Analytics.AnalyticsRangeRequest;
import synapsedesk.ticket.Analytics.OverviewResponse;
import synapsedesk.ticket.Analytics.SatisfactionResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `Query.analyticsOverview`, `analyticsAgents`, `analyticsDocuments`,
 * `analyticsKnowledgeGaps`, and the loader-backed edges on the three list
 * findings — `analytics.resolver.ts`, reproduced.
 *
 * <p>Its own cache namespace (`analytics-gql:`), separate from
 * {@code AnalyticsController}'s (`analytics:`). Node shares one cache entry
 * across both transports because both read the same TypeScript object; here
 * the two transports serialize two DIFFERENT Java types (REST's
 * `BigDecimal`-typed generated DTOs vs. these native-typed records), so
 * sharing a Redis key would bet on two independently-evolving classes
 * staying JSON-shape-identical. A departure from Node's cache TOPOLOGY, not
 * its cache POLICY — the TTLs and the partial-failure shape are unchanged.
 */
@Controller
public class AnalyticsResolver {

  private static final long DEADLINE_SECONDS = 5;
  private static final long OPEN_RANGE_TTL_SECONDS = 60;
  private static final long CLOSED_RANGE_TTL_SECONDS = 24 * 60 * 60;
  private static final String CACHE_SCOPE_PREFIX = "analytics-gql:";
  private static final String TICKET_SERVICE = "ticket-service";
  private static final String INGESTION_SERVICE = "ingestion-service";
  /** `ANALYTICS_TOP_N.DEFAULT` — the schema already declares this as `limit`'s default; this is the fallback for an explicit `null`. */
  private static final int ANALYTICS_TOP_N_DEFAULT = 20;

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics;
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledger;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public AnalyticsResolver(
    AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics,
    AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledger,
    CurrentUser currentUser,
    CacheService cache
  ) {
    this.analytics = analytics;
    this.ledger = ledger;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public AnalyticsOverviewGqlDto analyticsOverview(
    @Argument String from,
    @Argument String to
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    return cached(
      "overview",
      rangeParams(from, to),
      to,
      context,
      AnalyticsOverviewGqlDto.class,
      () -> {
        OverviewResponse response = withMetadata(
          analytics,
          context
        ).getOverview(
          AnalyticsRangeRequest.newBuilder().setFrom(from).setTo(to).build()
        );
        return AnalyticsMapper.toOverviewGqlDto(response);
      }
    );
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public AgentAnalyticsGqlDto analyticsAgents(
    @Argument String from,
    @Argument String to
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    return cached(
      "agents",
      rangeParams(from, to),
      to,
      context,
      AgentAnalyticsGqlDto.class,
      () -> agents(from, to, context)
    );
  }

  private AgentAnalyticsGqlDto agents(
    String from,
    String to,
    RequestContext context
  ) {
    List<UnavailableBlockGqlDto> unavailable = new ArrayList<>();

    AgentStatsResponse stats = tryLeg(TICKET_SERVICE, unavailable, () ->
      withMetadata(analytics, context).getAgentStats(
        AnalyticsRangeRequest.newBuilder().setFrom(from).setTo(to).build()
      )
    );
    // `hydrateNames: false`'s Java equivalent: the users leg is simply never
    // called. `AgentStat.agent` resolves through the users loader instead,
    // on demand, batched with every other user on the request.
    AiUsageResponse usage = tryLeg(INGESTION_SERVICE, unavailable, () ->
      withMetadata(ledger, context).getAiUsage(
        AiUsageRequest.newBuilder().setFrom(from).setTo(to).build()
      )
    );

    List<AgentStatGqlDto> items = new ArrayList<>();
    if (stats != null) {
      for (AgentStat row : stats.getItemsList()) {
        items.add(
          AnalyticsMapper.toAgentStatGqlDto(
            row,
            usage != null ? usage.getDraftAcceptance() : null
          )
        );
      }
    }

    return new AgentAnalyticsGqlDto(
      items,
      unavailable,
      stalest(
        stats != null && stats.hasDataThrough() ? stats.getDataThrough() : null,
        usage != null && usage.hasDataThrough() ? usage.getDataThrough() : null
      )
    );
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public DocumentAnalyticsGqlDto analyticsDocuments(@Argument Integer limit) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    // `limit: Int = 20` is nullable in the schema — an explicit `null` from a
    // client is legal even though the schema default only substitutes on
    // OMISSION, so this is the fallback that case needs.
    int effectiveLimit = limit != null ? limit : ANALYTICS_TOP_N_DEFAULT;

    Map<String, String> params = new LinkedHashMap<>();
    params.put("limit", String.valueOf(effectiveLimit));

    return cached(
      "documents",
      params,
      "",
      context,
      DocumentAnalyticsGqlDto.class,
      () -> documents(effectiveLimit, context)
    );
  }

  private DocumentAnalyticsGqlDto documents(int limit, RequestContext context) {
    List<UnavailableBlockGqlDto> unavailable = new ArrayList<>();

    DocumentAnalyticsResponse documents = tryLeg(
      INGESTION_SERVICE,
      unavailable,
      () ->
        withMetadata(ledger, context).getDocumentAnalytics(
          DocumentAnalyticsRequest.newBuilder().setLimit(limit).build()
        )
    );

    // Citation accuracy over a trailing year — a wide range so the figure
    // means something.
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    String yearFrom = today.minusYears(1).toString();
    String yearTo = today.toString();
    SatisfactionResponse satisfaction = tryLeg(
      TICKET_SERVICE,
      unavailable,
      () ->
        withMetadata(analytics, context).getSatisfaction(
          AnalyticsRangeRequest.newBuilder()
            .setFrom(yearFrom)
            .setTo(yearTo)
            .build()
        )
    );

    return new DocumentAnalyticsGqlDto(
      satisfaction != null
        ? AnalyticsMapper.toRateGqlDto(satisfaction.getCitationAccuracyTotal())
        : null,
      stalest(
        documents != null && documents.hasDataThrough()
          ? documents.getDataThrough()
          : null,
        satisfaction != null && satisfaction.hasDataThrough()
          ? satisfaction.getDataThrough()
          : null
      ),
      documents != null
        ? documents
            .getMostCitedList()
            .stream()
            .map(AnalyticsMapper::toDocumentUsageGqlDto)
            .toList()
        : List.of(),
      documents != null
        ? documents
            .getNeverRetrievedList()
            .stream()
            .map(AnalyticsMapper::toDocumentUsageGqlDto)
            .toList()
        : List.of(),
      documents != null
        ? documents
            .getRetrievedNeverCitedList()
            .stream()
            .map(AnalyticsMapper::toDocumentUsageGqlDto)
            .toList()
        : List.of(),
      unavailable
    );
  }

  @QueryMapping
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public KnowledgeGapsGqlDto analyticsKnowledgeGaps(
    @Argument String from,
    @Argument String to,
    @Argument Integer limit
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    int effectiveLimit = limit != null ? limit : ANALYTICS_TOP_N_DEFAULT;

    Map<String, String> params = rangeParams(from, to);
    params.put("limit", String.valueOf(effectiveLimit));

    return cached(
      "knowledge-gaps",
      params,
      to,
      context,
      KnowledgeGapsGqlDto.class,
      () -> knowledgeGaps(from, to, effectiveLimit, context)
    );
  }

  private KnowledgeGapsGqlDto knowledgeGaps(
    String from,
    String to,
    int limit,
    RequestContext context
  ) {
    List<UnavailableBlockGqlDto> unavailable = new ArrayList<>();

    KnowledgeGapsResponse gaps = tryLeg(INGESTION_SERVICE, unavailable, () ->
      withMetadata(ledger, context).getKnowledgeGaps(
        KnowledgeGapsRequest.newBuilder()
          .setFrom(from)
          .setTo(to)
          .setLimit(limit)
          .build()
      )
    );

    List<KnowledgeGapFlagGqlDto> flags = new ArrayList<>();
    if (gaps != null) {
      for (KnowledgeGapDocumentFlag flag : gaps.getFlagsList()) {
        flags.add(
          new KnowledgeGapFlagGqlDto(
            flag.getDocumentId(),
            flag.getDocumentTitle(),
            toFlagType(flag.getFlagType()),
            flag.getDetail()
          )
        );
      }
    }

    return new KnowledgeGapsGqlDto(
      gaps != null ? gaps.getAnsweringGenerations() : 0,
      gaps != null ? gaps.getAttachmentEmptyRetrievals() : 0,
      gaps != null
        ? AnalyticsMapper.toRateGqlDto(gaps.getAttachmentGroundedRate())
        : AnalyticsMapper.emptyRate(),
      gaps != null && gaps.hasDataThrough() ? gaps.getDataThrough() : null,
      gaps != null
        ? AnalyticsMapper.toRateGqlDto(gaps.getEmptyRetrievalRate())
        : AnalyticsMapper.emptyRate(),
      gaps != null ? gaps.getEmptyRetrievals() : 0,
      flags,
      unavailable
    );
  }

  // ------------------------------------------------------------- edges

  @SchemaMapping(typeName = "AgentStat", field = "agent")
  public CompletableFuture<UserSummaryGqlDto> agent(
    AgentStatGqlDto stat,
    DataLoader<String, UserSummaryGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(stat.agentId(), context);
  }

  @SchemaMapping(typeName = "DocumentUsage", field = "document")
  public CompletableFuture<DocumentGqlDto> documentUsageDocument(
    DocumentUsageGqlDto usage,
    DataLoader<String, DocumentGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(usage.documentId(), context);
  }

  @SchemaMapping(typeName = "KnowledgeGapFlag", field = "document")
  public CompletableFuture<DocumentGqlDto> knowledgeGapFlagDocument(
    KnowledgeGapFlagGqlDto flag,
    DataLoader<String, DocumentGqlDto> loader
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(flag.documentId(), context);
  }

  // --------------------------------------------------------------------- caching

  private <T> T cached(
    String endpoint,
    Map<String, String> params,
    String to,
    RequestContext context,
    Class<T> type,
    Supplier<T> produce
  ) {
    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE_PREFIX + endpoint,
      params
    );

    return cache.wrap(key, ttlSecondsFor(to), type, produce);
  }

  private static long ttlSecondsFor(String to) {
    String today = LocalDate.now(ZoneOffset.UTC).toString();
    return to != null && !to.isEmpty() && to.compareTo(today) < 0
      ? CLOSED_RANGE_TTL_SECONDS
      : OPEN_RANGE_TTL_SECONDS;
  }

  private static Map<String, String> rangeParams(String from, String to) {
    Map<String, String> params = new LinkedHashMap<>();
    params.put("from", from);
    params.put("to", to);
    return params;
  }

  // -------------------------------------------------------- partial-failure legs

  /** A leg that may fail WITHOUT failing the request — `tryLeg`, reproduced. */
  private static <T> T tryLeg(
    String source,
    List<UnavailableBlockGqlDto> unavailable,
    Supplier<T> call
  ) {
    try {
      return call.get();
    } catch (RuntimeException failure) {
      String reason =
        failure instanceof StatusRuntimeException statusFailure &&
        statusFailure.getStatus().getDescription() != null
          ? statusFailure.getStatus().getDescription()
          : String.valueOf(failure.getMessage());
      unavailable.add(new UnavailableBlockGqlDto(source, reason));

      return null;
    }
  }

  /** The OLDEST of the legs' `dataThrough` — a composed answer is only as fresh as its stalest input. */
  private static String stalest(String a, String b) {
    if (a == null) return b;
    if (b == null) return a;
    return a.compareTo(b) < 0 ? a : b;
  }

  private static String toFlagType(
    synapsedesk.ingestion.Document.DocumentFlagType flagType
  ) {
    return flagType ==
      synapsedesk.ingestion.Document.DocumentFlagType.DOCUMENT_FLAG_TYPE_UNSPECIFIED
      ? null
      : flagType.name().replace("DOCUMENT_FLAG_TYPE_", "");
  }

  private static <S extends io.grpc.stub.AbstractBlockingStub<S>> S withMetadata(
    S stub,
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}

package com.synapsedesk.gateway.analytics;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.api.AnalyticsApi;
import com.synapsedesk.gateway.generated.model.AgentAnalyticsResponseDto;
import com.synapsedesk.gateway.generated.model.AgentStatResponseDto;
import com.synapsedesk.gateway.generated.model.AiUsagePointResponseDto;
import com.synapsedesk.gateway.generated.model.AiUsageResponseDto;
import com.synapsedesk.gateway.generated.model.AiUsageSliceResponseDto;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerAgentsV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerAiUsageV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerDeflectionV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerDocumentsV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerKnowledgeGapsV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerOverviewV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerResponseTimesV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerSatisfactionV1200Response;
import com.synapsedesk.gateway.generated.model.AnalyticsControllerVolumeV1200Response;
import com.synapsedesk.gateway.generated.model.CreateExportDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DeflectionPointResponseDto;
import com.synapsedesk.gateway.generated.model.DeflectionResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentAnalyticsResponseDto;
import com.synapsedesk.gateway.generated.model.DocumentUsageResponseDto;
import com.synapsedesk.gateway.generated.model.ExportResponseDto;
import com.synapsedesk.gateway.generated.model.KnowledgeGapFlagResponseDto;
import com.synapsedesk.gateway.generated.model.KnowledgeGapsResponseDto;
import com.synapsedesk.gateway.generated.model.MeanResponseDto;
import com.synapsedesk.gateway.generated.model.OverviewResponseDto;
import com.synapsedesk.gateway.generated.model.RateResponseDto;
import com.synapsedesk.gateway.generated.model.ResponseTimePointResponseDto;
import com.synapsedesk.gateway.generated.model.ResponseTimesResponseDto;
import com.synapsedesk.gateway.generated.model.SatisfactionPointResponseDto;
import com.synapsedesk.gateway.generated.model.SatisfactionResponseDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateExportV1202Response;
import com.synapsedesk.gateway.generated.model.UnavailableBlockResponseDto;
import com.synapsedesk.gateway.generated.model.VolumeBreakdownResponseDto;
import com.synapsedesk.gateway.generated.model.VolumePointResponseDto;
import com.synapsedesk.gateway.generated.model.VolumeResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.ListUsersByIdsResponse;
import synapsedesk.auth.User.UserProjection;
import synapsedesk.ingestion.AiLedgerServiceGrpc;
import synapsedesk.ingestion.Ledger.AiUsageRequest;
import synapsedesk.ingestion.Ledger.AiUsageResponse;
import synapsedesk.ingestion.Ledger.DocumentAnalyticsResponse;
import synapsedesk.ingestion.Ledger.KnowledgeGapDocumentFlag;
import synapsedesk.ingestion.Ledger.KnowledgeGapsRequest;
import synapsedesk.ingestion.Ledger.KnowledgeGapsResponse;
import synapsedesk.ticket.Analytics.AgentStat;
import synapsedesk.ticket.Analytics.AgentStatsResponse;
import synapsedesk.ticket.Analytics.AnalyticsRangeRequest;
import synapsedesk.ticket.Analytics.CreateExportRequest;
import synapsedesk.ticket.Analytics.DeflectionResponse;
import synapsedesk.ticket.Analytics.ExportResponse;
import synapsedesk.ticket.Analytics.GetExportRequest;
import synapsedesk.ticket.Analytics.MeanValue;
import synapsedesk.ticket.Analytics.OverviewResponse;
import synapsedesk.ticket.Analytics.RateValue;
import synapsedesk.ticket.Analytics.ResponseTimesResponse;
import synapsedesk.ticket.Analytics.SatisfactionResponse;
import synapsedesk.ticket.Analytics.VolumeResponse;
import synapsedesk.ticket.AnalyticsServiceGrpc;

/**
 * `AnalyticsApi` — the executive dashboard, `analytics.read` throughout
 * (class-level in Node, reproduced the same way here since every one of the
 * 11 routes needs it). Ported from `analytics.service.ts` /
 * `analytics-grpc.client.ts` / `analytics.mapper.ts` in one file, the way
 * `ChatController` folds Node's controller+service+mapper together.
 *
 * <p><b>Nine of the eleven routes are cached</b> through {@link CacheService}
 * — its first real production caller. `createExport`/`getExport` are not: a
 * job's status changes on a timescale a cache would freeze.
 *
 * <p><b>Three routes compose across peers</b> (`agents`, `documents`,
 * `knowledgeGaps`): ticket-service, the new ingestion-service channel this
 * module pays for, and — for `agents`' name hydration — auth-service. A leg
 * that fails does not fail the request; it is recorded in `unavailable` and
 * the rest of the answer still renders, matching `tryLeg`/`unwrap` in the
 * Node client.
 *
 * <p>{@code ponytail:} legs run SEQUENTIALLY, not in `Promise.all`'s true
 * parallel — the blocking stub has no cheap fan-out primitive here, and
 * nothing observable from outside (the response shape, the partial-failure
 * behaviour) depends on wall-clock overlap. Move to `CompletableFuture` if a
 * latency budget ever makes this endpoint's p99 the thing to fix.
 */
@RestController
public class AnalyticsController implements AnalyticsApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final long OPEN_RANGE_TTL_SECONDS = 60;
  private static final long CLOSED_RANGE_TTL_SECONDS = 24 * 60 * 60;
  private static final String INGESTION_SERVICE = "ingestion-service";

  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics;
  private final AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledger;
  private final synapsedesk.auth.UserServiceGrpc.UserServiceBlockingStub users;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public AnalyticsController(
      AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics,
      AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledger,
      synapsedesk.auth.UserServiceGrpc.UserServiceBlockingStub users,
      CurrentUser currentUser,
      CacheService cache) {
    this.analytics = analytics;
    this.ledger = ledger;
    this.users = users;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  private AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analyticsWith(RequestContext context) {
    return analytics
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  private AiLedgerServiceGrpc.AiLedgerServiceBlockingStub ledgerWith(RequestContext context) {
    return ledger
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  private synapsedesk.auth.UserServiceGrpc.UserServiceBlockingStub usersWith(RequestContext context) {
    return users
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  // ------------------------------------------------------- the six range reads

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerOverviewV1200Response> analyticsControllerOverviewV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    OverviewResponseDto data =
        cachedGetDto(
            "overview",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            OverviewResponseDto.class,
            () -> toOverviewDto(analyticsWith(context).getOverview(rangeRequest(from, to, departmentId, granularity))));

    return ResponseEntity.ok(
        new AnalyticsControllerOverviewV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerDeflectionV1200Response> analyticsControllerDeflectionV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    DeflectionResponseDto data =
        cachedGetDto(
            "deflection",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            DeflectionResponseDto.class,
            () -> toDeflectionDto(analyticsWith(context).getDeflection(rangeRequest(from, to, departmentId, granularity))));

    return ResponseEntity.ok(
        new AnalyticsControllerDeflectionV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerResponseTimesV1200Response> analyticsControllerResponseTimesV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    ResponseTimesResponseDto data =
        cachedGetDto(
            "response-times",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            ResponseTimesResponseDto.class,
            () -> toResponseTimesDto(analyticsWith(context).getResponseTimes(rangeRequest(from, to, departmentId, granularity))));

    return ResponseEntity.ok(
        new AnalyticsControllerResponseTimesV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerVolumeV1200Response> analyticsControllerVolumeV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    VolumeResponseDto data =
        cachedGetDto(
            "volume",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            VolumeResponseDto.class,
            () -> toVolumeDto(analyticsWith(context).getVolume(rangeRequest(from, to, departmentId, granularity))));

    return ResponseEntity.ok(
        new AnalyticsControllerVolumeV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerSatisfactionV1200Response> analyticsControllerSatisfactionV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    SatisfactionResponseDto data =
        cachedGetDto(
            "satisfaction",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            SatisfactionResponseDto.class,
            () -> toSatisfactionDto(analyticsWith(context).getSatisfaction(rangeRequest(from, to, departmentId, granularity))));

    return ResponseEntity.ok(
        new AnalyticsControllerSatisfactionV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerAiUsageV1200Response> analyticsControllerAiUsageV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    AiUsageRequest.Builder wire = AiUsageRequest.newBuilder().setFrom(from).setTo(to);
    if (granularity != null) {
      wire.setGranularity(granularity);
    }

    AiUsageResponseDto data =
        cachedGetDto(
            "ai-usage",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            AiUsageResponseDto.class,
            () -> toAiUsageDto(ledgerWith(context).getAiUsage(wire.build())));

    return ResponseEntity.ok(
        new AnalyticsControllerAiUsageV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  // -------------------------------------------------------------- the export pair

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<TicketsControllerCreateExportV1202Response> analyticsControllerCreateExportV1(
      CreateExportDto createExportDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateExportRequest.Builder wire =
        CreateExportRequest.newBuilder()
            .setKind(toProtoExportKind(createExportDto.getKind().getValue()))
            .setFrom(createExportDto.getFrom())
            .setTo(createExportDto.getTo())
            .setFilters(
                createExportDto.getFilters() == null || createExportDto.getFilters().isEmpty()
                    ? ""
                    : toJson(createExportDto.getFilters()));
    UUID departmentId = createExportDto.getDepartmentId();
    if (departmentId != null) {
      wire.setDepartmentId(departmentId.toString());
    }

    ExportResponse response = analyticsWith(context).createExport(wire.build());

    return new ResponseEntity<>(
        new TicketsControllerCreateExportV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(202))
            .message("OK")
            .data(toExportDto(response)),
        HttpStatus.ACCEPTED);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<TicketsControllerCreateExportV1202Response> analyticsControllerGetExportV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ExportResponse response =
        analyticsWith(context).getExport(GetExportRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new TicketsControllerCreateExportV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toExportDto(response)));
  }

  // ------------------------------------------------------ the three composed reads

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerAgentsV1200Response> analyticsControllerAgentsV1(
      String from, String to, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AgentAnalyticsResponseDto data =
        cachedGetDto(
            "agents",
            rangeParams(from, to, departmentId, granularity),
            to,
            context,
            AgentAnalyticsResponseDto.class,
            () -> agents(from, to, departmentId, granularity, context));

    return ResponseEntity.ok(
        new AnalyticsControllerAgentsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private AgentAnalyticsResponseDto agents(
      String from, String to, UUID departmentId, String granularity, RequestContext context) {
    List<UnavailableBlockResponseDto> unavailable = new ArrayList<>();

    AnalyticsRangeRequest request = rangeRequest(from, to, departmentId, granularity);
    AgentStatsResponse stats =
        tryLeg("ticket-service", unavailable, () -> analyticsWith(context).getAgentStats(request));
    AiUsageResponse usage =
        tryLeg(
            INGESTION_SERVICE,
            unavailable,
            () -> ledgerWith(context).getAiUsage(AiUsageRequest.newBuilder().setFrom(from).setTo(to).build()));

    List<AgentStatResponseDto> items = new ArrayList<>();
    if (stats != null) {
      for (AgentStat row : stats.getItemsList()) {
        AgentStatResponseDto item =
            new AgentStatResponseDto()
                .agentId(row.getAgentId())
                .fullName(null)
                .assigned(BigDecimal.valueOf(row.getAssigned()))
                .resolved(BigDecimal.valueOf(row.getResolved()))
                .messagesSent(BigDecimal.valueOf(row.getMessagesSent()))
                .resolutionSeconds(toMeanDto(row.getResolutionSeconds()))
                .draftAcceptance(usage != null ? toRateDto(usage.getDraftAcceptance()) : null);
        items.add(item);
      }
    }

    // Hydration last, and only when there is anything to hydrate.
    if (!items.isEmpty()) {
      List<String> agentIds = items.stream().map(AgentStatResponseDto::getAgentId).toList();
      ListUsersByIdsResponse names =
          tryLeg(
              "auth-service",
              unavailable,
              () ->
                  usersWith(context)
                      .listUsersByIds(
                          ListUsersByIdsRequest.newBuilder()
                              .setOrganizationId(context.organizationId() == null ? "" : context.organizationId())
                              .addAllUserIds(agentIds)
                              .setIncludeInactive(true)
                              .setProjection(UserProjection.USER_PROJECTION_SUMMARY)
                              .build()));

      if (names != null) {
        Map<String, String> byId = new LinkedHashMap<>();
        names.getSummariesList().forEach(summary -> byId.put(summary.getUserId(), summary.getFullName()));
        for (AgentStatResponseDto item : items) {
          item.setFullName(byId.get(item.getAgentId()));
        }
      }
    }

    return new AgentAnalyticsResponseDto()
        .items(items)
        .dataThrough(
            stalest(
                stats != null && stats.hasDataThrough() ? stats.getDataThrough() : null,
                usage != null && usage.hasDataThrough() ? usage.getDataThrough() : null))
        .unavailable(unavailable);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerKnowledgeGapsV1200Response> analyticsControllerKnowledgeGapsV1(
      String from, String to, BigDecimal limit, UUID departmentId, String granularity) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    Map<String, String> params = rangeParams(from, to, departmentId, granularity);
    params.put("limit", limit.toString());

    KnowledgeGapsResponseDto data =
        cachedGetDto(
            "knowledge-gaps",
            params,
            to,
            context,
            KnowledgeGapsResponseDto.class,
            () -> knowledgeGaps(from, to, limit, context));

    return ResponseEntity.ok(
        new AnalyticsControllerKnowledgeGapsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private KnowledgeGapsResponseDto knowledgeGaps(String from, String to, BigDecimal limit, RequestContext context) {
    List<UnavailableBlockResponseDto> unavailable = new ArrayList<>();

    KnowledgeGapsResponse gaps =
        tryLeg(
            INGESTION_SERVICE,
            unavailable,
            () ->
                ledgerWith(context)
                    .getKnowledgeGaps(
                        KnowledgeGapsRequest.newBuilder()
                            .setFrom(from)
                            .setTo(to)
                            .setLimit(limit.intValue())
                            .build()));

    List<KnowledgeGapFlagResponseDto> flags = new ArrayList<>();
    if (gaps != null) {
      for (KnowledgeGapDocumentFlag flag : gaps.getFlagsList()) {
        flags.add(
            new KnowledgeGapFlagResponseDto()
                .documentId(flag.getDocumentId())
                .documentTitle(flag.getDocumentTitle())
                .flagType(toFlagTypeEnum(flag.getFlagType()))
                .detail(flag.getDetail()));
      }
    }

    return new KnowledgeGapsResponseDto()
        .emptyRetrievals(BigDecimal.valueOf(gaps != null ? gaps.getEmptyRetrievals() : 0))
        .answeringGenerations(BigDecimal.valueOf(gaps != null ? gaps.getAnsweringGenerations() : 0))
        .emptyRetrievalRate(gaps != null ? toRateDto(gaps.getEmptyRetrievalRate()) : emptyRate())
        .attachmentGroundedRate(gaps != null ? toRateDto(gaps.getAttachmentGroundedRate()) : emptyRate())
        .attachmentEmptyRetrievals(BigDecimal.valueOf(gaps != null ? gaps.getAttachmentEmptyRetrievals() : 0))
        .flags(flags)
        .dataThrough(gaps != null && gaps.hasDataThrough() ? gaps.getDataThrough() : null)
        .unavailable(unavailable);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ANALYTICS_READ)
  public ResponseEntity<AnalyticsControllerDocumentsV1200Response> analyticsControllerDocumentsV1(BigDecimal limit) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    Map<String, String> params = new LinkedHashMap<>();
    params.put("limit", limit.toString());

    DocumentAnalyticsResponseDto data =
        cachedGetDto(
            "documents",
            params,
            "",
            context,
            DocumentAnalyticsResponseDto.class,
            () -> documents(limit, context));

    return ResponseEntity.ok(
        new AnalyticsControllerDocumentsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  private DocumentAnalyticsResponseDto documents(BigDecimal limit, RequestContext context) {
    List<UnavailableBlockResponseDto> unavailable = new ArrayList<>();

    DocumentAnalyticsResponse documents =
        tryLeg(
            INGESTION_SERVICE,
            unavailable,
            () -> ledgerWith(context).getDocumentAnalytics(
                synapsedesk.ingestion.Ledger.DocumentAnalyticsRequest.newBuilder()
                    .setLimit(limit.intValue())
                    .build()));

    // Citation accuracy over a trailing year — a wide range so the figure
    // means something.
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    String yearFrom = today.minusYears(1).toString();
    String yearTo = today.toString();
    SatisfactionResponse satisfaction =
        tryLeg(
            "ticket-service",
            unavailable,
            () ->
                analyticsWith(context)
                    .getSatisfaction(
                        AnalyticsRangeRequest.newBuilder().setFrom(yearFrom).setTo(yearTo).build()));

    return new DocumentAnalyticsResponseDto()
        .mostCited(documents != null ? toDocumentUsageDtos(documents.getMostCitedList()) : List.of())
        .neverRetrieved(documents != null ? toDocumentUsageDtos(documents.getNeverRetrievedList()) : List.of())
        .retrievedNeverCited(
            documents != null ? toDocumentUsageDtos(documents.getRetrievedNeverCitedList()) : List.of())
        .citationAccuracy(satisfaction != null ? toRateDto(satisfaction.getCitationAccuracyTotal()) : null)
        .dataThrough(
            stalest(
                documents != null && documents.hasDataThrough() ? documents.getDataThrough() : null,
                satisfaction != null && satisfaction.hasDataThrough() ? satisfaction.getDataThrough() : null))
        .unavailable(unavailable);
  }

  // --------------------------------------------------------------------- caching

  private <T> T cachedGetDto(
      String endpoint, Map<String, String> params, String to, RequestContext context, Class<T> dtoType, Supplier<T> produce) {
    String key = cache.buildKey(context.organizationId(), "analytics:" + endpoint, params);

    return cache.wrap(key, ttlSecondsFor(to), dtoType, produce);
  }

  /** A CLOSED range (strictly before today) gets a long TTL; an OPEN one changes constantly. */
  private static long ttlSecondsFor(String to) {
    String today = LocalDate.now(ZoneOffset.UTC).toString();

    return to != null && to.compareTo(today) < 0 ? CLOSED_RANGE_TTL_SECONDS : OPEN_RANGE_TTL_SECONDS;
  }

  private static Map<String, String> rangeParams(String from, String to, UUID departmentId, String granularity) {
    Map<String, String> params = new LinkedHashMap<>();
    params.put("from", from);
    params.put("to", to);
    if (departmentId != null) {
      params.put("departmentId", departmentId.toString());
    }
    if (granularity != null) {
      params.put("granularity", granularity);
    }

    return params;
  }

  private static AnalyticsRangeRequest rangeRequest(String from, String to, UUID departmentId, String granularity) {
    AnalyticsRangeRequest.Builder wire = AnalyticsRangeRequest.newBuilder().setFrom(from).setTo(to);
    if (departmentId != null) {
      wire.setDepartmentId(departmentId.toString());
    }
    if (granularity != null) {
      wire.setGranularity(granularity);
    }

    return wire.build();
  }

  // -------------------------------------------------------- partial-failure legs

  /** A leg that may fail WITHOUT failing the request — `tryLeg`, reproduced. */
  private static <T> T tryLeg(String source, List<UnavailableBlockResponseDto> unavailable, Supplier<T> call) {
    try {
      return call.get();
    } catch (RuntimeException failure) {
      String reason =
          failure instanceof StatusRuntimeException statusFailure && statusFailure.getStatus().getDescription() != null
              ? statusFailure.getStatus().getDescription()
              : String.valueOf(failure.getMessage());
      unavailable.add(new UnavailableBlockResponseDto().source(source).reason(reason));

      return null;
    }
  }

  /** The OLDEST of the legs' `dataThrough` — a composed answer is only as fresh as its stalest input. */
  private static String stalest(String a, String b) {
    if (a == null) return b;
    if (b == null) return a;

    return a.compareTo(b) < 0 ? a : b;
  }

  private static RateResponseDto emptyRate() {
    return new RateResponseDto().rate(null).numerator(BigDecimal.ZERO).denominator(BigDecimal.ZERO);
  }

  // ------------------------------------------------------------------ mappers

  private static RateResponseDto toRateDto(RateValue value) {
    return new RateResponseDto()
        .rate(value.hasRate() ? BigDecimal.valueOf(value.getRate()) : null)
        .numerator(BigDecimal.valueOf(value.getNumerator()))
        .denominator(BigDecimal.valueOf(value.getDenominator()));
  }

  private static RateResponseDto toRateDto(synapsedesk.ingestion.Ledger.AiRateValue value) {
    return new RateResponseDto()
        .rate(value.hasRate() ? BigDecimal.valueOf(value.getRate()) : null)
        .numerator(BigDecimal.valueOf(value.getNumerator()))
        .denominator(BigDecimal.valueOf(value.getDenominator()));
  }

  private static MeanResponseDto toMeanDto(MeanValue value) {
    return new MeanResponseDto()
        .mean(value.hasMean() ? BigDecimal.valueOf(value.getMean()) : null)
        .count(BigDecimal.valueOf(value.getCount()));
  }

  private static MeanResponseDto toMeanDto(synapsedesk.ingestion.Ledger.AiMeanValue value) {
    return new MeanResponseDto()
        .mean(value.hasMean() ? BigDecimal.valueOf(value.getMean()) : null)
        .count(BigDecimal.valueOf(value.getCount()));
  }

  private static OverviewResponseDto toOverviewDto(OverviewResponse response) {
    return new OverviewResponseDto()
        .ticketsCreated(BigDecimal.valueOf(response.getTicketsCreated()))
        .ticketsResolved(BigDecimal.valueOf(response.getTicketsResolved()))
        .ticketsEscalated(BigDecimal.valueOf(response.getTicketsEscalated()))
        .openTickets(BigDecimal.valueOf(response.getOpenTickets()))
        .deflection(toRateDto(response.getDeflection()))
        .csat(toRateDto(response.getCsat()))
        .humanFirstResponseSeconds(toMeanDto(response.getHumanFirstResponseSeconds()))
        .aiFirstResponseSeconds(toMeanDto(response.getAiFirstResponseSeconds()))
        .resolutionSeconds(toMeanDto(response.getResolutionSeconds()))
        .openTicketMedianAgeSeconds(
            response.hasOpenTicketMedianAgeSeconds() ? BigDecimal.valueOf(response.getOpenTicketMedianAgeSeconds()) : null)
        .computedAt(response.hasComputedAt() ? toOffsetDateTime(response.getComputedAt()) : null)
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static DeflectionResponseDto toDeflectionDto(DeflectionResponse response) {
    List<DeflectionPointResponseDto> points =
        response.getPointsList().stream()
            .map(
                point ->
                    new DeflectionPointResponseDto()
                        .day(point.getDay())
                        .deflection(toRateDto(point.getDeflection()))
                        .chatConversations(BigDecimal.valueOf(point.getChatConversations()))
                        .chatResolvedWithoutEscalation(BigDecimal.valueOf(point.getChatResolvedWithoutEscalation())))
            .toList();

    return new DeflectionResponseDto()
        .points(points)
        .total(toRateDto(response.getTotal()))
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static ResponseTimesResponseDto toResponseTimesDto(ResponseTimesResponse response) {
    List<ResponseTimePointResponseDto> points =
        response.getPointsList().stream()
            .map(
                point ->
                    new ResponseTimePointResponseDto()
                        .day(point.getDay())
                        .humanFirstResponseSeconds(toMeanDto(point.getHumanFirstResponseSeconds()))
                        .aiFirstResponseSeconds(toMeanDto(point.getAiFirstResponseSeconds()))
                        .resolutionSeconds(toMeanDto(point.getResolutionSeconds())))
            .toList();

    return new ResponseTimesResponseDto()
        .points(points)
        .humanTotal(toMeanDto(response.getHumanTotal()))
        .aiTotal(toMeanDto(response.getAiTotal()))
        .resolutionTotal(toMeanDto(response.getResolutionTotal()))
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static VolumeResponseDto toVolumeDto(VolumeResponse response) {
    List<VolumePointResponseDto> points =
        response.getPointsList().stream()
            .map(
                point ->
                    new VolumePointResponseDto()
                        .day(point.getDay())
                        .created(BigDecimal.valueOf(point.getCreated()))
                        .resolved(BigDecimal.valueOf(point.getResolved()))
                        .escalated(BigDecimal.valueOf(point.getEscalated())))
            .toList();

    return new VolumeResponseDto()
        .points(points)
        .byStatus(toBreakdownDtos(response.getByStatusList()))
        .byPriority(toBreakdownDtos(response.getByPriorityList()))
        .bySource(toBreakdownDtos(response.getBySourceList()))
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static List<VolumeBreakdownResponseDto> toBreakdownDtos(
      List<synapsedesk.ticket.Analytics.VolumeBreakdown> breakdowns) {
    return breakdowns.stream()
        .map(b -> new VolumeBreakdownResponseDto().key(b.getKey()).count(BigDecimal.valueOf(b.getCount())))
        .toList();
  }

  private static SatisfactionResponseDto toSatisfactionDto(SatisfactionResponse response) {
    List<SatisfactionPointResponseDto> points =
        response.getPointsList().stream()
            .map(
                point ->
                    new SatisfactionPointResponseDto()
                        .day(point.getDay())
                        .csat(toRateDto(point.getCsat()))
                        .citationAccuracy(toRateDto(point.getCitationAccuracy())))
            .toList();

    return new SatisfactionResponseDto()
        .points(points)
        .csatTotal(toRateDto(response.getCsatTotal()))
        .citationAccuracyTotal(toRateDto(response.getCitationAccuracyTotal()))
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static AiUsageResponseDto toAiUsageDto(AiUsageResponse response) {
    List<AiUsagePointResponseDto> points =
        response.getPointsList().stream()
            .map(
                point ->
                    new AiUsagePointResponseDto()
                        .day(point.getDay())
                        .generations(BigDecimal.valueOf(point.getGenerations()))
                        .costMicros(BigDecimal.valueOf(point.getCostMicros())))
            .toList();

    return new AiUsageResponseDto()
        .points(points)
        .byPurpose(response.getByPurposeList().stream().map(AnalyticsController::toAiUsageSliceDto).toList())
        .byModel(response.getByModelList().stream().map(AnalyticsController::toAiUsageSliceDto).toList())
        .totalCostMicros(BigDecimal.valueOf(response.getTotalCostMicros()))
        .totalGenerations(BigDecimal.valueOf(response.getTotalGenerations()))
        .monthlyBudgetMicros(BigDecimal.valueOf(response.getMonthlyBudgetMicros()))
        .aiModelTier(toAiModelTierEnum(response.getAiModelTier()))
        .draftAcceptance(toRateDto(response.getDraftAcceptance()))
        .emptyRetrievalRate(toRateDto(response.getEmptyRetrievalRate()))
        .computedAt(response.hasComputedAt() ? toOffsetDateTime(response.getComputedAt()) : null)
        .dataThrough(response.hasDataThrough() ? response.getDataThrough() : null);
  }

  private static AiUsageSliceResponseDto toAiUsageSliceDto(synapsedesk.ingestion.Ledger.AiUsageSlice slice) {
    return new AiUsageSliceResponseDto()
        .purpose(slice.getPurpose())
        .modelName(slice.getModelName())
        .generations(BigDecimal.valueOf(slice.getGenerations()))
        .promptTokens(BigDecimal.valueOf(slice.getPromptTokens()))
        .completionTokens(BigDecimal.valueOf(slice.getCompletionTokens()))
        .costMicros(BigDecimal.valueOf(slice.getCostMicros()))
        .latencyMs(toMeanDto(slice.getLatencyMs()))
        .failureRate(toRateDto(slice.getFailureRate()));
  }

  private static List<DocumentUsageResponseDto> toDocumentUsageDtos(
      List<synapsedesk.ingestion.Ledger.DocumentUsageStat> stats) {
    return stats.stream()
        .map(
            stat ->
                new DocumentUsageResponseDto()
                    .documentId(stat.getDocumentId())
                    .title(stat.getTitle())
                    .retrievalCount(BigDecimal.valueOf(stat.getRetrievalCount()))
                    .citationCount(BigDecimal.valueOf(stat.getCitationCount()))
                    .chunkCount(BigDecimal.valueOf(stat.getChunkCount())))
        .toList();
  }

  private static ExportResponseDto toExportDto(ExportResponse response) {
    return new ExportResponseDto()
        .id(response.getId())
        .status(toExportStatusEnum(response.getStatus()))
        .kind(toExportKindEnum(response.getKind()))
        .rowCount(response.hasRowCount() ? BigDecimal.valueOf(response.getRowCount()) : null)
        .rollupComputedAt(response.hasRollupComputedAt() ? toOffsetDateTime(response.getRollupComputedAt()) : null)
        .downloadUrl(response.hasDownloadUrl() ? response.getDownloadUrl() : null)
        .error(response.hasError() ? response.getError() : null)
        .createdAt(response.hasCreatedAt() ? toOffsetDateTime(response.getCreatedAt()) : toOffsetDateTime(0))
        .completedAt(response.hasCompletedAt() ? toOffsetDateTime(response.getCompletedAt()) : null);
  }

  // ----------------------------------------------------------- enum bridges

  private static synapsedesk.ticket.Analytics.ExportKind toProtoExportKind(String value) {
    return synapsedesk.ticket.Analytics.ExportKind.valueOf("EXPORT_KIND_" + value);
  }

  private static ExportResponseDto.StatusEnum toExportStatusEnum(synapsedesk.ticket.Analytics.ExportStatus status) {
    return ExportResponseDto.StatusEnum.fromValue(status.name().replace("EXPORT_STATUS_", ""));
  }

  private static ExportResponseDto.KindEnum toExportKindEnum(synapsedesk.ticket.Analytics.ExportKind kind) {
    return ExportResponseDto.KindEnum.fromValue(kind.name().replace("EXPORT_KIND_", ""));
  }

  private static KnowledgeGapFlagResponseDto.FlagTypeEnum toFlagTypeEnum(
      synapsedesk.ingestion.Document.DocumentFlagType flagType) {
    return KnowledgeGapFlagResponseDto.FlagTypeEnum.fromValue(flagType.name().replace("DOCUMENT_FLAG_TYPE_", ""));
  }

  private static AiUsageResponseDto.AiModelTierEnum toAiModelTierEnum(synapsedesk.auth.Common.AiModelTier tier) {
    return AiUsageResponseDto.AiModelTierEnum.fromValue(tier.name().replace("AI_MODEL_TIER_", ""));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private static OffsetDateTime toOffsetDateTime(long epochSecond) {
    return Instant.ofEpochSecond(epochSecond).atOffset(ZoneOffset.UTC);
  }

  private static String toJson(Map<String, Object> filters) {
    StringBuilder json = new StringBuilder("{");
    boolean first = true;
    for (var entry : filters.entrySet()) {
      if (!first) {
        json.append(',');
      }
      json.append('"').append(entry.getKey().replace("\"", "\\\"")).append("\":\"")
          .append(String.valueOf(entry.getValue()).replace("\"", "\\\""))
          .append('"');
      first = false;
    }

    return json.append('}').toString();
  }
}

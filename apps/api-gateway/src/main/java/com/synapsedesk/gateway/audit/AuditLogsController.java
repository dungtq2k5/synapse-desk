package com.synapsedesk.gateway.audit;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.AuditActionsResponseDto;
import com.synapsedesk.gateway.model.AuditLogResponseDto;
import com.synapsedesk.gateway.model.CreateAuditLogExportDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.ExportResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.AuditActionFilter;
import com.synapsedesk.gateway.web.AuditResourceTypeFilter;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import com.synapsedesk.gateway.web.SortDirection;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Analytics.CreateExportRequest;
import synapsedesk.ticket.Analytics.ExportResponse;
import synapsedesk.ticket.Analytics.GetExportRequest;
import synapsedesk.ticket.AnalyticsServiceGrpc;
import synapsedesk.ticket.Audit.AuditAction;
import synapsedesk.ticket.Audit.AuditLogResponse;
import synapsedesk.ticket.Audit.AuditResourceType;
import synapsedesk.ticket.Audit.ListAuditActionsRequest;
import synapsedesk.ticket.Audit.ListAuditActionsResponse;
import synapsedesk.ticket.Audit.ListAuditLogsRequest;
import synapsedesk.ticket.Audit.ListAuditLogsResponse;
import synapsedesk.ticket.AuditServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `AuditLogsApi` — the tenant's own immutable trail, against ticket-service's
 * `AuditService`. The export pair shares the SAME lifecycle
 * `AnalyticsController` already ports (one table, one queue, one processor,
 * one poll for all three export kinds) — this module owns the ROUTE, not a
 * second copy of the machinery, so it dials `AnalyticsServiceGrpc` directly
 * with {@code EXPORT_KIND_AUDIT_LOG} rather than duplicating the export
 * state machine.
 *
 * <p><b>Migrated off `AuditLogsApi`.</b> `createExport` answers 202 —
 * {@code @ResponseStatus} is what tells springdoc that. {@code
 * PlatformAuditLogsController} still reuses {@link #toListAuditLogsRequest},
 * {@link #toAuditLogResponseDto} and {@link #toAuditActionsResponseDto} as
 * package-visible statics — signatures unchanged, so that reuse survives
 * this migration unaffected. {@code toMetaDto} is gone: this class's own
 * list route now builds its {@code meta} via {@link PageMeta#from}, the
 * same factory `PlatformAuditLogsController` already bypassed it with.
 */
@Tag(name = "Audit Logs")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class AuditLogsController {

  private static final Logger LOG = LoggerFactory.getLogger(
    AuditLogsController.class
  );
  private static final long DEADLINE_SECONDS = 5;

  private final AuditServiceGrpc.AuditServiceBlockingStub stub;
  private final AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics;
  private final CurrentUser currentUser;
  private final ObjectMapper json;

  public AuditLogsController(
    AuditServiceGrpc.AuditServiceBlockingStub stub,
    AnalyticsServiceGrpc.AnalyticsServiceBlockingStub analytics,
    CurrentUser currentUser,
    ObjectMapper json
  ) {
    this.stub = stub;
    this.analytics = analytics;
    this.currentUser = currentUser;
    this.json = json;
  }

  @GetMapping(value = "/audit-logs", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.AUDIT_READ)
  public ResponseEntity<
    ApiResponse<PagedData<AuditLogResponseDto>>
  > auditLogsControllerListV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) String sortBy,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "action",
      required = false
    ) @Nullable AuditActionFilter actionFilter,
    @Valid @RequestParam(
      value = "userId",
      required = false
    ) @Nullable UUID userId,
    @Valid @RequestParam(
      value = "resourceType",
      required = false
    ) @Nullable AuditResourceTypeFilter resourceTypeFilter,
    @Valid @RequestParam(
      value = "resourceId",
      required = false
    ) @Nullable UUID resourceId,
    @Valid @RequestParam(value = "from", required = false) @DateTimeFormat(
      iso = DateTimeFormat.ISO.DATE_TIME
    ) @Nullable OffsetDateTime from,
    @Valid @RequestParam(value = "to", required = false) @DateTimeFormat(
      iso = DateTimeFormat.ISO.DATE_TIME
    ) @Nullable OffsetDateTime to
  ) {
    String action = actionFilter == null ? null : actionFilter.name();
    String resourceType =
      resourceTypeFilter == null ? null : resourceTypeFilter.name();
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListAuditLogsResponse response = withMetadata(context).listAuditLogs(
      toListAuditLogsRequest(
        page,
        limit,
        sortBy,
        sortOrder.name(),
        action,
        userId,
        resourceType,
        resourceId,
        from,
        to,
        false
      )
    );

    PagedData<AuditLogResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(log -> toAuditLogResponseDto(log, json))
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(value = "/audit-logs/actions", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.AUDIT_READ)
  public ResponseEntity<
    ApiResponse<AuditActionsResponseDto>
  > auditLogsControllerListActionsV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListAuditActionsResponse response = withMetadata(context).listAuditActions(
      ListAuditActionsRequest.newBuilder().setPlatformScope(false).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toAuditActionsResponseDto(response))
    );
  }

  @PostMapping(
    value = "/audit-logs/export",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @RequirePermission(PermissionCodesEnum.AUDIT_EXPORT)
  public ResponseEntity<
    ApiResponse<ExportResponseDto>
  > auditLogsControllerCreateExportV1(
    @Valid @RequestBody CreateAuditLogExportDto createAuditLogExportDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateExportRequest.Builder wire = CreateExportRequest.newBuilder()
      .setKind(synapsedesk.ticket.Analytics.ExportKind.EXPORT_KIND_AUDIT_LOG)
      .setFrom(createAuditLogExportDto.getFrom())
      .setTo(createAuditLogExportDto.getTo())
      .setFilters(
        createAuditLogExportDto.getFilters() == null ||
          createAuditLogExportDto.getFilters().isEmpty()
          ? ""
          : json.writeValueAsString(createAuditLogExportDto.getFilters())
      );

    ExportResponse response = withAnalyticsMetadata(context).createExport(
      wire.build()
    );

    return new ResponseEntity<>(
      ApiResponse.of(202, "OK", toExportDto(response)),
      HttpStatus.ACCEPTED
    );
  }

  @GetMapping(
    value = "/audit-logs/export/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.AUDIT_EXPORT)
  public ResponseEntity<
    ApiResponse<ExportResponseDto>
  > auditLogsControllerGetExportV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ExportResponse response = withAnalyticsMetadata(context).getExport(
      GetExportRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", toExportDto(response)));
  }

  static ListAuditLogsRequest toListAuditLogsRequest(
    BigDecimal page,
    BigDecimal limit,
    String sortBy,
    String sortOrder,
    String action,
    UUID userId,
    String resourceType,
    UUID resourceId,
    OffsetDateTime from,
    OffsetDateTime to,
    boolean platformScope
  ) {
    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equals(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );

    ListAuditLogsRequest.Builder wire = ListAuditLogsRequest.newBuilder()
      .setPage(pageRequest)
      .setAction(toAuditActionFilter(action))
      .setResourceType(toResourceTypeFilter(resourceType))
      .setPlatformScope(platformScope);
    if (userId != null) {
      wire.setUserId(userId.toString());
    }
    if (resourceId != null) {
      wire.setResourceId(resourceId.toString());
    }
    if (from != null) {
      wire.setFrom(toTimestamp(from));
    }
    if (to != null) {
      wire.setTo(toTimestamp(to));
    }
    return wire.build();
  }

  static AuditAction toAuditActionFilter(String action) {
    if (action == null) {
      return AuditAction.AUDIT_ACTION_UNSPECIFIED;
    }
    try {
      AuditAction parsed = AuditAction.valueOf("AUDIT_ACTION_" + action);
      if (parsed == AuditAction.AUDIT_ACTION_UNSPECIFIED) {
        throw new IllegalArgumentException(action);
      }
      return parsed;
    } catch (IllegalArgumentException notARealAction) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "action is not a recognized audit action"
      );
    }
  }

  static AuditResourceType toResourceTypeFilter(String resourceType) {
    if (resourceType == null) {
      return AuditResourceType.AUDIT_RESOURCE_TYPE_UNSPECIFIED;
    }
    try {
      AuditResourceType parsed = AuditResourceType.valueOf(
        "AUDIT_RESOURCE_TYPE_" + resourceType
      );
      if (parsed == AuditResourceType.AUDIT_RESOURCE_TYPE_UNSPECIFIED) {
        throw new IllegalArgumentException(resourceType);
      }
      return parsed;
    } catch (IllegalArgumentException notARealResourceType) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "resourceType is not a recognized resource type"
      );
    }
  }

  static AuditLogResponseDto toAuditLogResponseDto(
    AuditLogResponse log,
    ObjectMapper json
  ) {
    return new AuditLogResponseDto(
      log.getId(),
      log.hasOrganizationId() ? log.getOrganizationId() : null,
      log.hasUserId() ? log.getUserId() : null,
      toActionEnum(log.getAction()),
      toResourceTypeEnum(log.getResourceType()),
      log.hasResourceId() ? log.getResourceId() : null,
      log.hasIpAddress() ? log.getIpAddress() : null,
      log.hasUserAgent() ? log.getUserAgent() : null,
      parseMetadata(log.getMetadata(), log.getId(), json),
      toOffsetDateTime(log.getCreatedAt())
    );
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> parseMetadata(
    String raw,
    String logId,
    ObjectMapper json
  ) {
    if (raw == null || raw.isEmpty()) {
      return Map.of();
    }
    try {
      return json.readValue(raw, Map.class);
    } catch (RuntimeException malformed) {
      LOG.warn("Audit log {} has unparseable metadata", logId);
      return new HashMap<>();
    }
  }

  static AuditActionsResponseDto toAuditActionsResponseDto(
    ListAuditActionsResponse response
  ) {
    return new AuditActionsResponseDto(
      response
        .getActionsList()
        .stream()
        .map(AuditLogsController::toActionsEnum)
        .filter(java.util.Objects::nonNull)
        .toList()
    );
  }

  static AuditLogResponseDto.ActionEnum toActionEnum(AuditAction action) {
    if (
      action == AuditAction.AUDIT_ACTION_UNSPECIFIED ||
      action == AuditAction.UNRECOGNIZED
    ) {
      return null;
    }
    return AuditLogResponseDto.ActionEnum.fromValue(
      action.name().replace("AUDIT_ACTION_", "")
    );
  }

  static AuditActionsResponseDto.ActionsEnum toActionsEnum(AuditAction action) {
    if (
      action == AuditAction.AUDIT_ACTION_UNSPECIFIED ||
      action == AuditAction.UNRECOGNIZED
    ) {
      return null;
    }
    return AuditActionsResponseDto.ActionsEnum.fromValue(
      action.name().replace("AUDIT_ACTION_", "")
    );
  }

  static AuditLogResponseDto.ResourceTypeEnum toResourceTypeEnum(
    AuditResourceType resourceType
  ) {
    if (
      resourceType == AuditResourceType.AUDIT_RESOURCE_TYPE_UNSPECIFIED ||
      resourceType == AuditResourceType.UNRECOGNIZED
    ) {
      return null;
    }
    return AuditLogResponseDto.ResourceTypeEnum.fromValue(
      resourceType.name().replace("AUDIT_RESOURCE_TYPE_", "")
    );
  }

  private static ExportResponseDto toExportDto(ExportResponse response) {
    return new ExportResponseDto()
      .id(response.getId())
      .status(
        ExportResponseDto.StatusEnum.fromValue(
          response.getStatus().name().replace("EXPORT_STATUS_", "")
        )
      )
      .kind(
        ExportResponseDto.KindEnum.fromValue(
          response.getKind().name().replace("EXPORT_KIND_", "")
        )
      )
      .rowCount(
        response.hasRowCount()
          ? BigDecimal.valueOf(response.getRowCount())
          : null
      )
      .rollupComputedAt(
        response.hasRollupComputedAt()
          ? toOffsetDateTime(response.getRollupComputedAt())
          : null
      )
      .downloadUrl(response.hasDownloadUrl() ? response.getDownloadUrl() : null)
      .error(response.hasError() ? response.getError() : null)
      .createdAt(
        response.hasCreatedAt()
          ? toOffsetDateTime(response.getCreatedAt())
          : toOffsetDateTime(0)
      )
      .completedAt(
        response.hasCompletedAt()
          ? toOffsetDateTime(response.getCompletedAt())
          : null
      );
  }

  private static OffsetDateTime toOffsetDateTime(long epochSecond) {
    return Instant.ofEpochSecond(epochSecond).atOffset(ZoneOffset.UTC);
  }

  static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  static com.google.protobuf.Timestamp toTimestamp(OffsetDateTime dateTime) {
    Instant instant = dateTime.toInstant();
    return com.google.protobuf.Timestamp.newBuilder()
      .setSeconds(instant.getEpochSecond())
      .setNanos(instant.getNano())
      .build();
  }

  private AuditServiceGrpc.AuditServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private AnalyticsServiceGrpc.AnalyticsServiceBlockingStub withAnalyticsMetadata(
    RequestContext context
  ) {
    return analytics
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}

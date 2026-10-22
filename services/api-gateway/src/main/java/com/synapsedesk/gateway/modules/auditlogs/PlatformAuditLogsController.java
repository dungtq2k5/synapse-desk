package com.synapsedesk.gateway.modules.auditlogs;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.SuperAdminOnly;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.AuditActionFilter;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.AuditActionsResponseDto;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.AuditLogResponseDto;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.AuditResourceTypeFilter;
import com.synapsedesk.gateway.modules.auditlogs.dto.rest.PlatformAuditLogResponseDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Platform.ResolveAuditNamesRequest;
import synapsedesk.auth.Platform.ResolveAuditNamesResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.ticket.Audit.ListAuditActionsRequest;
import synapsedesk.ticket.Audit.ListAuditActionsResponse;
import synapsedesk.ticket.Audit.ListAuditLogsResponse;
import synapsedesk.ticket.AuditServiceGrpc;
import tools.jackson.databind.ObjectMapper;

/**
 * `PlatformAuditLogsApi` — the platform's OWN trail (rows with no
 * organization, per RDM §1.7), against the same ticket-service
 * `AuditService` {@link AuditLogsController} uses, with {@code
 * platform_scope=true} on the wire.
 *
 * <p>
 * <b>Gated by {@link SuperAdminCheck}, not a permission code.</b> RBAC is
 * tenant-scoped, and a Super Admin has no organization to hang a permission
 * row off. The check runs inline rather than as a route annotation — there is no
 * framework guard layer here, the same shape as {@code GuestCheck} and
 * {@code requireEmailVerified}.
 *
 * <p><b>Migrated off `PlatformAuditLogsApi`.</b> Still reuses {@link
 * AuditLogsController#toAuditLogResponseDto}/{@code toAuditActionsResponseDto}
 * — real domain mappers, unaffected by this flip — but builds its OWN {@link
 * PageMeta} rather than {@code AuditLogsController.toMetaDto}'s generated
 * artifact type, so this controller's migration does not depend on {@code
 * AuditLogsController}'s.
 */
@Tag(name = "PlatformAuditLogs")
@RestController
// Refused to anyone but a super admin, before the body is read (SessionInterceptor, from this marker). A super admin has no tenant, so the lifecycle gate never decides here either: the route is exempt outright.
@SuperAdminOnly
@OrgAccessKind(OrgAccess.AUTH)
@RequestMapping(ApiPaths.V1)
@Validated
public class PlatformAuditLogsController {

  private static final long DEADLINE_SECONDS = 5;
  private static final Logger LOG = LoggerFactory.getLogger(
    PlatformAuditLogsController.class
  );

  private final AuditServiceGrpc.AuditServiceBlockingStub stub;
  private final PlatformServiceGrpc.PlatformServiceBlockingStub platform;
  private final CurrentUser currentUser;
  private final SuperAdminCheck superAdminCheck;
  private final ObjectMapper json;

  public PlatformAuditLogsController(
    AuditServiceGrpc.AuditServiceBlockingStub stub,
    PlatformServiceGrpc.PlatformServiceBlockingStub platform,
    CurrentUser currentUser,
    SuperAdminCheck superAdminCheck,
    ObjectMapper json
  ) {
    this.stub = stub;
    this.platform = platform;
    this.currentUser = currentUser;
    this.superAdminCheck = superAdminCheck;
    this.json = json;
  }

  @GetMapping(value = "/platform/audit-logs", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<PlatformAuditLogResponseDto>>
  > platformAuditLogsControllerListV1(
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
    superAdminCheck.require(context);

    ListAuditLogsResponse response = withMetadata(context).listAuditLogs(
      AuditLogsController.toListAuditLogsRequest(
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
        true
      )
    );

    List<PlatformAuditLogResponseDto> items = response
      .getItemsList()
      .stream()
      .map(log ->
        PlatformAuditLogResponseDto.of(
          AuditLogsController.toAuditLogResponseDto(log, json)
        )
      )
      .toList();
    name(items, context);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new PagedData<>(items, PageMeta.from(response.getMeta()))
      )
    );
  }

  /**
   * Names for the page's people, organizations and plans, read in one call to
   * auth. A failed lookup leaves the names null: the trail still reads, by id.
   */
  private void name(
    List<PlatformAuditLogResponseDto> items,
    RequestContext context
  ) {
    ResolveAuditNamesRequest.Builder wire =
      ResolveAuditNamesRequest.newBuilder();
    wire.addAllUserIds(
      new LinkedHashSet<>(
        items
          .stream()
          .map(AuditLogResponseDto::getUserId)
          .filter(java.util.Objects::nonNull)
          .toList()
      )
    );
    wire.addAllOrganizationIds(
      resourceIds(items, AuditLogResponseDto.ResourceTypeEnum.ORGANIZATION)
    );
    wire.addAllPlanIds(
      resourceIds(items, AuditLogResponseDto.ResourceTypeEnum.SUBSCRIPTION_PLAN)
    );

    ResolveAuditNamesResponse names;
    try {
      names = platform
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .resolveAuditNames(wire.build());
    } catch (RuntimeException unavailable) {
      LOG.warn("Audit names unavailable: {}", unavailable.getMessage());
      return;
    }

    for (PlatformAuditLogResponseDto entry : items) {
      if (entry.getUserId() != null) {
        entry.setActorName(names.getUsersMap().get(entry.getUserId()));
      }
      if (entry.getResourceId() == null) continue;
      if (
        entry.getResourceType() ==
        AuditLogResponseDto.ResourceTypeEnum.ORGANIZATION
      ) {
        entry.setResourceName(
          names.getOrganizationsMap().get(entry.getResourceId())
        );
      } else if (
        entry.getResourceType() ==
        AuditLogResponseDto.ResourceTypeEnum.SUBSCRIPTION_PLAN
      ) {
        entry.setResourceName(names.getPlansMap().get(entry.getResourceId()));
      }
    }
  }

  private static LinkedHashSet<String> resourceIds(
    List<PlatformAuditLogResponseDto> items,
    AuditLogResponseDto.ResourceTypeEnum type
  ) {
    return new LinkedHashSet<>(
      items
        .stream()
        .filter(entry -> entry.getResourceType() == type)
        .map(AuditLogResponseDto::getResourceId)
        .filter(java.util.Objects::nonNull)
        .toList()
    );
  }

  @GetMapping(
    value = "/platform/audit-logs/actions",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<AuditActionsResponseDto>
  > platformAuditLogsControllerListActionsV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    ListAuditActionsResponse response = withMetadata(context).listAuditActions(
      ListAuditActionsRequest.newBuilder().setPlatformScope(true).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        AuditLogsController.toAuditActionsResponseDto(response)
      )
    );
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
}

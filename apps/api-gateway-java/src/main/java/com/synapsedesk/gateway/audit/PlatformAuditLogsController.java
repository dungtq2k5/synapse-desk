package com.synapsedesk.gateway.audit;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.model.AuditActionsResponseDto;
import com.synapsedesk.gateway.model.AuditLogResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import com.synapsedesk.gateway.web.SortDirection;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
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
 * <b>Gated by {@link SuperAdminCheck}, not a permission code.</b> Node's own
 * `SuperAdminGuard` reproduced: RBAC is tenant-scoped, and a Super Admin has
 * no organization to hang a permission row off. This is the first route in
 * this port needing that door rather than {@code @RequirePermission}, so it
 * is checked inline rather than as a route annotation — there is no
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
// Refused to anyone but a super admin, whom the gate exempts, so the gate never decides here. Node's guard refuses first; this check runs in the handler, after the gate, so the route is exempt outright.
@OrgAccessKind(OrgAccess.AUTH)
@RequestMapping(ApiPaths.V1)
@Validated
public class PlatformAuditLogsController {

  private static final long DEADLINE_SECONDS = 5;

  private final AuditServiceGrpc.AuditServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final SuperAdminCheck superAdminCheck;
  private final ObjectMapper json;

  public PlatformAuditLogsController(
    AuditServiceGrpc.AuditServiceBlockingStub stub,
    CurrentUser currentUser,
    SuperAdminCheck superAdminCheck,
    ObjectMapper json
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.superAdminCheck = superAdminCheck;
    this.json = json;
  }

  @GetMapping(value = "/platform/audit-logs", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<AuditLogResponseDto>>
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
    ) @Nullable String action,
    @Valid @RequestParam(
      value = "userId",
      required = false
    ) @Nullable UUID userId,
    @Valid @RequestParam(
      value = "resourceType",
      required = false
    ) @Nullable String resourceType,
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

    PagedData<AuditLogResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(log -> AuditLogsController.toAuditLogResponseDto(log, json))
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
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

package com.synapsedesk.gateway.audit;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.generated.api.PlatformAuditLogsApi;
import com.synapsedesk.gateway.generated.model.AuditLogsControllerListActionsV1200Response;
import com.synapsedesk.gateway.generated.model.AuditLogsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.AuditLogsControllerListV1200ResponseData;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
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
 */
@RestController
public class PlatformAuditLogsController implements PlatformAuditLogsApi {

  private static final long DEADLINE_SECONDS = 5;

  private final AuditServiceGrpc.AuditServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final SuperAdminCheck superAdminCheck;
  private final ObjectMapper json;

  public PlatformAuditLogsController(
      AuditServiceGrpc.AuditServiceBlockingStub stub,
      CurrentUser currentUser,
      SuperAdminCheck superAdminCheck,
      ObjectMapper json) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.superAdminCheck = superAdminCheck;
    this.json = json;
  }

  @Override
  public ResponseEntity<AuditLogsControllerListV1200Response> platformAuditLogsControllerListV1(
      BigDecimal page,
      BigDecimal limit,
      String sortBy,
      String sortOrder,
      String action,
      UUID userId,
      String resourceType,
      UUID resourceId,
      OffsetDateTime from,
      OffsetDateTime to) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    ListAuditLogsResponse response =
        withMetadata(context)
            .listAuditLogs(
                AuditLogsController.toListAuditLogsRequest(
                    page, limit, sortBy, sortOrder, action, userId, resourceType, resourceId, from, to, true));

    AuditLogsControllerListV1200ResponseData data =
        new AuditLogsControllerListV1200ResponseData(
            response.getItemsList().stream().map(log -> AuditLogsController.toAuditLogResponseDto(log, json)).toList(),
            AuditLogsController.toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new AuditLogsControllerListV1200Response().success(true).statusCode(BigDecimal.valueOf(200)).message("OK").data(data));
  }

  @Override
  public ResponseEntity<AuditLogsControllerListActionsV1200Response> platformAuditLogsControllerListActionsV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());
    superAdminCheck.require(context);

    ListAuditActionsResponse response =
        withMetadata(context).listAuditActions(ListAuditActionsRequest.newBuilder().setPlatformScope(true).build());

    return ResponseEntity.ok(
        new AuditLogsControllerListActionsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(AuditLogsController.toAuditActionsResponseDto(response)));
  }

  private AuditServiceGrpc.AuditServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}

package com.synapsedesk.gateway.platform;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.IsoDateCheck;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.SuperAdminCheck;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.generated.model.BillingEventPointResponseDto;
import com.synapsedesk.gateway.generated.model.BillingEventsResponseDto;
import com.synapsedesk.gateway.generated.model.CreateGlobalRoleDto;
import com.synapsedesk.gateway.generated.model.DunningTenantResponseDto;
import com.synapsedesk.gateway.generated.model.FinanceDunningResponseDto;
import com.synapsedesk.gateway.generated.model.FinancePlanMixResponseDto;
import com.synapsedesk.gateway.generated.model.FinanceRevenueResponseDto;
import com.synapsedesk.gateway.generated.model.FinanceSnapshotResponseDto;
import com.synapsedesk.gateway.generated.model.FinanceTenantCountsResponseDto;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.PlatformControllerGetFinanceSnapshotV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerGetMetricsV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListBillingEventsV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListUsersV1200Response;
import com.synapsedesk.gateway.generated.model.PlatformControllerListUsersV1200ResponseData;
import com.synapsedesk.gateway.generated.model.PlatformMetricsResponseDto;
import com.synapsedesk.gateway.generated.model.PlatformUserResponseDto;
import com.synapsedesk.gateway.generated.model.RoleResponseDto;
import com.synapsedesk.gateway.generated.model.RolesControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.RolesControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.RolesControllerListV1200ResponseData;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Platform.CreateGlobalRoleRequest;
import synapsedesk.auth.Platform.FinanceSnapshotResponse;
import synapsedesk.auth.Platform.GetFinanceSnapshotRequest;
import synapsedesk.auth.Platform.GetPlatformMetricsRequest;
import synapsedesk.auth.Platform.ListBillingEventsRequest;
import synapsedesk.auth.Platform.ListBillingEventsResponse;
import synapsedesk.auth.Platform.ListGlobalRolesRequest;
import synapsedesk.auth.Platform.ListGlobalRolesResponse;
import synapsedesk.auth.Platform.ListPlatformUsersRequest;
import synapsedesk.auth.Platform.ListPlatformUsersResponse;
import synapsedesk.auth.Platform.PlatformMetricsResponse;
import synapsedesk.auth.Platform.PlatformUserResponse;
import synapsedesk.auth.PlatformServiceGrpc;
import synapsedesk.auth.Role.RoleResponse;

/**
 * `PlatformApi`'s users/global-roles/metrics/finance group (6 of 20
 * operations) — the second of three sub-passes across this interface (see
 * {@link PlatformOrganizationsService} for why this is a plain service, not
 * yet a routed controller).
 *
 * <p><b>{@code listGlobalRoles} forwards only {@code page}</b> — deliberately,
 * not an oversight. {@code ListGlobalRolesRequest} on the wire has no
 * sort/search/organizationId/includeDeleted fields at all (see {@code
 * platform.proto}); Node's own {@code platform.service.ts} accepts the same
 * query DTO as {@code listUsers} (for one shared query-param shape across
 * both cross-tenant listings) and silently drops everything the wire can't
 * carry. Reproduced exactly rather than "fixed", since the wire contract —
 * not the REST query shape — is the actual constraint.
 *
 * <p><b>{@code from}/{@code to} on {@code listBillingEvents}</b> carry no
 * ISO-8601 format constraint in the generated interface — same missing-
 * validation family as {@code PlatformJobsApi}'s {@code BackfillJobDto} —
 * checked via {@link com.synapsedesk.gateway.auth.IsoDateCheck}. Unlike
 * backfill, Node does NOT check {@code from > to} at the gateway (the
 * day-count ceiling is enforced in auth-service), so neither does this.
 */
@Component
public class PlatformUsersRolesFinanceService {

  private static final long DEADLINE_SECONDS = 5;

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub;
  private final SuperAdminCheck superAdminCheck;

  public PlatformUsersRolesFinanceService(
      PlatformServiceGrpc.PlatformServiceBlockingStub stub, SuperAdminCheck superAdminCheck) {
    this.stub = stub;
    this.superAdminCheck = superAdminCheck;
  }

  public ResponseEntity<PlatformControllerListUsersV1200Response> listUsers(
      RequestContext context, BigDecimal page, BigDecimal limit, String sortOrder, String searchTerm, String sortBy,
      Boolean includeDeleted, UUID organizationId) {
    superAdminCheck.require(context);

    ListPlatformUsersRequest.Builder wire =
        ListPlatformUsersRequest.newBuilder()
            .setPage(toPageRequest(page, limit, sortOrder, sortBy, searchTerm))
            .setIncludeDeleted(includeDeleted != null && includeDeleted);
    if (organizationId != null) {
      wire.setOrganizationId(organizationId.toString());
    }

    ListPlatformUsersResponse response = withMetadata(context).listUsers(wire.build());

    PlatformControllerListUsersV1200ResponseData data =
        new PlatformControllerListUsersV1200ResponseData(
            response.getItemsList().stream().map(PlatformUsersRolesFinanceService::toPlatformUserResponseDto).toList(),
            toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new PlatformControllerListUsersV1200Response().success(true).statusCode(BigDecimal.valueOf(200)).message("OK").data(data));
  }

  /** Only `page` reaches the wire — see the class docblock. */
  public ResponseEntity<RolesControllerListV1200Response> listGlobalRoles(
      RequestContext context, BigDecimal page, BigDecimal limit, String sortOrder, String searchTerm, String sortBy,
      Boolean includeDeleted, UUID organizationId) {
    superAdminCheck.require(context);

    ListGlobalRolesRequest wire =
        ListGlobalRolesRequest.newBuilder().setPage(toPageRequest(page, limit, sortOrder, sortBy, searchTerm)).build();

    ListGlobalRolesResponse response = withMetadata(context).listGlobalRoles(wire);

    RolesControllerListV1200ResponseData data =
        new RolesControllerListV1200ResponseData(
            response.getItemsList().stream().map(PlatformUsersRolesFinanceService::toRoleResponseDto).toList(),
            toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new RolesControllerListV1200Response().success(true).statusCode(BigDecimal.valueOf(200)).message("OK").data(data));
  }

  public ResponseEntity<RolesControllerCreateV1201Response> createGlobalRole(RequestContext context, CreateGlobalRoleDto dto) {
    superAdminCheck.require(context);

    CreateGlobalRoleRequest.Builder wire =
        CreateGlobalRoleRequest.newBuilder()
            .setName(dto.getName())
            .addAllPermissionCodes(
                dto.getPermissionCodes() == null
                    ? List.of()
                    : dto.getPermissionCodes().stream().map(CreateGlobalRoleDto.PermissionCodesEnum::getValue).toList());
    if (dto.getDescription() != null) {
      wire.setDescription(dto.getDescription());
    }

    RoleResponse response = withMetadata(context).createGlobalRole(wire.build());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new RolesControllerCreateV1201Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("OK")
                .data(toRoleResponseDto(response)));
  }

  public ResponseEntity<PlatformControllerGetMetricsV1200Response> getMetrics(RequestContext context) {
    superAdminCheck.require(context);

    PlatformMetricsResponse response =
        withMetadata(context).getMetrics(GetPlatformMetricsRequest.getDefaultInstance());

    Map<String, BigDecimal> byStatus =
        response.getOrganizationsByStatusMap().entrySet().stream()
            .collect(Collectors.toMap(Map.Entry::getKey, entry -> BigDecimal.valueOf(entry.getValue())));

    PlatformMetricsResponseDto data =
        new PlatformMetricsResponseDto()
            .totalOrganizations(BigDecimal.valueOf(response.getTotalOrganizations()))
            .organizationsByStatus(byStatus)
            .totalUsers(BigDecimal.valueOf(response.getTotalUsers()))
            .activeUsers(BigDecimal.valueOf(response.getActiveUsers()))
            .pendingInvitations(BigDecimal.valueOf(response.getPendingInvitations()))
            .liveSessions(BigDecimal.valueOf(response.getLiveSessions()))
            .seatsAllocated(BigDecimal.valueOf(response.getSeatsAllocated()))
            .seatsInUse(BigDecimal.valueOf(response.getSeatsInUse()))
            .generatedAt(toOffsetDateTime(response.getGeneratedAt()));

    return ResponseEntity.ok(
        new PlatformControllerGetMetricsV1200Response().success(true).statusCode(BigDecimal.valueOf(200)).message("OK").data(data));
  }

  public ResponseEntity<PlatformControllerGetFinanceSnapshotV1200Response> getFinanceSnapshot(RequestContext context) {
    superAdminCheck.require(context);

    FinanceSnapshotResponse response =
        withMetadata(context).getFinanceSnapshot(GetFinanceSnapshotRequest.getDefaultInstance());

    return ResponseEntity.ok(
        new PlatformControllerGetFinanceSnapshotV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toFinanceSnapshotResponseDto(response)));
  }

  public ResponseEntity<PlatformControllerListBillingEventsV1200Response> listBillingEvents(
      RequestContext context, String from, String to) {
    superAdminCheck.require(context);

    IsoDateCheck.requireIsoDate(from, "from");
    IsoDateCheck.requireIsoDate(to, "to");

    ListBillingEventsResponse response =
        withMetadata(context).listBillingEvents(ListBillingEventsRequest.newBuilder().setFrom(from).setTo(to).build());

    BillingEventsResponseDto data =
        new BillingEventsResponseDto()
            .points(response.getPointsList().stream().map(PlatformUsersRolesFinanceService::toBillingEventPointDto).toList())
            .currentlyOffboarded(
                response.getCurrentlyOffboardedList().stream()
                    .map(PlatformUsersRolesFinanceService::toBillingEventPointDto)
                    .toList())
            .observedEventTypes(response.getObservedEventTypesList());

    return ResponseEntity.ok(
        new PlatformControllerListBillingEventsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }


  private static PageRequest toPageRequest(
      BigDecimal page, BigDecimal limit, String sortOrder, String sortBy, String searchTerm) {
    PageRequest.Builder pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }
    return pageRequest.build();
  }

  private static PlatformUserResponseDto toPlatformUserResponseDto(PlatformUserResponse row) {
    return new PlatformUserResponseDto()
        .user(UserMapper.toUserResponseDto(row.getUser()))
        .organizationId(row.hasOrganizationId() ? row.getOrganizationId() : null)
        .organizationName(row.hasOrganizationName() ? row.getOrganizationName() : null)
        .roleNames(row.getRoleNamesList())
        .deletedAt(row.hasDeletedAt() ? toOffsetDateTime(row.getDeletedAt()) : null);
  }

  private static RoleResponseDto toRoleResponseDto(RoleResponse role) {
    return new RoleResponseDto()
        .id(role.getId())
        .name(role.getName())
        .description(role.hasDescription() ? role.getDescription() : null)
        .isSystemRole(role.getIsSystemRole())
        .userAssigned(BigDecimal.valueOf(role.getUserAssigned()))
        .permissionCodes(
            role.getPermissionCodesList().stream().map(RoleResponseDto.PermissionCodesEnum::fromValue).toList())
        .createdAt(toOffsetDateTime(role.getCreatedAt()))
        .updatedAt(toOffsetDateTime(role.getUpdatedAt()));
  }

  private static FinanceSnapshotResponseDto toFinanceSnapshotResponseDto(FinanceSnapshotResponse response) {
    Map<String, BigDecimal> byStatus =
        response.getTenants().getByStatusMap().entrySet().stream()
            .collect(Collectors.toMap(Map.Entry::getKey, entry -> BigDecimal.valueOf(entry.getValue())));

    return new FinanceSnapshotResponseDto()
        .tenants(new FinanceTenantCountsResponseDto().total(BigDecimal.valueOf(response.getTenants().getTotal())).byStatus(byStatus))
        .plans(
            response.getPlansList().stream()
                .map(
                    plan ->
                        new FinancePlanMixResponseDto()
                            .planId(plan.getPlanId())
                            .planName(plan.getPlanName())
                            .subscribers(BigDecimal.valueOf(plan.getSubscribers()))
                            .seatsAllocated(BigDecimal.valueOf(plan.getSeatsAllocated())))
                .toList())
        .dunning(
            new FinanceDunningResponseDto()
                .pastDue(BigDecimal.valueOf(response.getDunning().getPastDue()))
                .tenants(
                    response.getDunning().getTenantsList().stream()
                        .map(
                            tenant ->
                                new DunningTenantResponseDto()
                                    .id(tenant.getId())
                                    .name(tenant.getName())
                                    .updatedAt(toOffsetDateTime(tenant.getUpdatedAt())))
                        .toList()))
        .revenue(
            new FinanceRevenueResponseDto()
                .available(response.getRevenue().getAvailable())
                .unavailableReason(response.getRevenue().hasUnavailableReason() ? response.getRevenue().getUnavailableReason() : null)
                .estimatedMrr(response.getRevenue().hasEstimatedMrr() ? BigDecimal.valueOf(response.getRevenue().getEstimatedMrr()) : null)
                .currency(response.getRevenue().hasCurrency() ? response.getRevenue().getCurrency() : null)
                .activeSubscriptions(
                    response.getRevenue().hasActiveSubscriptions()
                        ? BigDecimal.valueOf(response.getRevenue().getActiveSubscriptions())
                        : null)
                .computedAt(response.getRevenue().hasComputedAt() ? toOffsetDateTime(response.getRevenue().getComputedAt()) : null)
                .excludes(response.getRevenue().getExcludesList()))
        .generatedAt(toOffsetDateTime(response.getGeneratedAt()));
  }

  private static BillingEventPointResponseDto toBillingEventPointDto(synapsedesk.auth.Platform.BillingEventPoint point) {
    return new BillingEventPointResponseDto()
        .day(point.getDay())
        .eventType(point.getEventType())
        .count(BigDecimal.valueOf(point.getCount()));
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(synapsedesk.auth.Common.PageMeta meta) {
    return new InvitationsControllerListV1200ResponseDataMeta(
        BigDecimal.valueOf(meta.getTotalItems()),
        BigDecimal.valueOf(meta.getItemCount()),
        BigDecimal.valueOf(meta.getItemsPerPage()),
        BigDecimal.valueOf(meta.getTotalPages()),
        BigDecimal.valueOf(meta.getCurrentPage()));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private PlatformServiceGrpc.PlatformServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}

package com.synapsedesk.gateway.platform;

import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.SuperAdminCheck;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.model.BillingEventPointResponseDto;
import com.synapsedesk.gateway.model.BillingEventsResponseDto;
import com.synapsedesk.gateway.model.CreateGlobalRoleDto;
import com.synapsedesk.gateway.model.DunningTenantResponseDto;
import com.synapsedesk.gateway.model.FinanceDunningResponseDto;
import com.synapsedesk.gateway.model.FinancePlanMixResponseDto;
import com.synapsedesk.gateway.model.FinanceRevenueResponseDto;
import com.synapsedesk.gateway.model.FinanceSnapshotResponseDto;
import com.synapsedesk.gateway.model.FinanceTenantCountsResponseDto;
import com.synapsedesk.gateway.model.PlatformMetricsResponseDto;
import com.synapsedesk.gateway.model.PlatformUserResponseDto;
import com.synapsedesk.gateway.model.RoleResponseDto;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
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
 * platform.proto}); the route accepts the same query DTO as {@code listUsers}
 * (one shared query-param shape across both cross-tenant listings) and
 * silently drops everything the wire can't carry, since the wire contract —
 * not the REST query shape — is the actual constraint.
 *
 * <p><b>{@code from}/{@code to} on {@code listBillingEvents}</b> must be real
 * calendar dates with {@code from} not after {@code to}, or 400. The controller
 * checks the {@code YYYY-MM-DD} shape; this checks the rest, because auth-service
 * reads {@code 2026-02-30} as 2 March rather than refusing it. The day-count
 * ceiling is enforced in auth-service.
 */
@Component
public class PlatformUsersRolesFinanceService {

  private static final long DEADLINE_SECONDS = 5;

  private final PlatformServiceGrpc.PlatformServiceBlockingStub stub;
  private final SuperAdminCheck superAdminCheck;

  public PlatformUsersRolesFinanceService(
    PlatformServiceGrpc.PlatformServiceBlockingStub stub,
    SuperAdminCheck superAdminCheck
  ) {
    this.stub = stub;
    this.superAdminCheck = superAdminCheck;
  }

  public ResponseEntity<
    ApiResponse<PagedData<PlatformUserResponseDto>>
  > listUsers(
    RequestContext context,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    UUID organizationId
  ) {
    superAdminCheck.require(context);

    ListPlatformUsersRequest.Builder wire =
      ListPlatformUsersRequest.newBuilder()
        .setPage(toPageRequest(page, limit, sortOrder, sortBy, searchTerm))
        .setIncludeDeleted(includeDeleted != null && includeDeleted);
    if (organizationId != null) {
      wire.setOrganizationId(organizationId.toString());
    }

    ListPlatformUsersResponse response = withMetadata(context).listUsers(
      wire.build()
    );

    PagedData<PlatformUserResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(PlatformUsersRolesFinanceService::toPlatformUserResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  /** Only `page` reaches the wire — see the class docblock. */
  public ResponseEntity<
    ApiResponse<PagedData<RoleResponseDto>>
  > listGlobalRoles(
    RequestContext context,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    UUID organizationId
  ) {
    superAdminCheck.require(context);

    ListGlobalRolesRequest wire = ListGlobalRolesRequest.newBuilder()
      .setPage(toPageRequest(page, limit, sortOrder, sortBy, searchTerm))
      .build();

    ListGlobalRolesResponse response = withMetadata(context).listGlobalRoles(
      wire
    );

    PagedData<RoleResponseDto> data = new PagedData<>(
      response
        .getItemsList()
        .stream()
        .map(PlatformUsersRolesFinanceService::toRoleResponseDto)
        .toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  public ResponseEntity<ApiResponse<RoleResponseDto>> createGlobalRole(
    RequestContext context,
    CreateGlobalRoleDto dto
  ) {
    superAdminCheck.require(context);

    CreateGlobalRoleRequest.Builder wire = CreateGlobalRoleRequest.newBuilder()
      .setName(dto.getName())
      .addAllPermissionCodes(
        dto
          .getPermissionCodes()
          .stream()
          .map(CreateGlobalRoleDto.PermissionCodesEnum::getValue)
          .toList()
      );
    if (dto.getDescription() != null) {
      wire.setDescription(dto.getDescription());
    }

    RoleResponse response = withMetadata(context).createGlobalRole(
      wire.build()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "OK", toRoleResponseDto(response))
    );
  }

  public ResponseEntity<ApiResponse<PlatformMetricsResponseDto>> getMetrics(
    RequestContext context
  ) {
    superAdminCheck.require(context);

    PlatformMetricsResponse response = withMetadata(context).getMetrics(
      GetPlatformMetricsRequest.getDefaultInstance()
    );

    Map<String, BigDecimal> byStatus = response
      .getOrganizationsByStatusMap()
      .entrySet()
      .stream()
      .collect(
        Collectors.toMap(Map.Entry::getKey, entry ->
          BigDecimal.valueOf(entry.getValue())
        )
      );

    PlatformMetricsResponseDto data = new PlatformMetricsResponseDto()
      .totalOrganizations(BigDecimal.valueOf(response.getTotalOrganizations()))
      .organizationsByStatus(byStatus)
      .totalUsers(BigDecimal.valueOf(response.getTotalUsers()))
      .activeUsers(BigDecimal.valueOf(response.getActiveUsers()))
      .pendingInvitations(BigDecimal.valueOf(response.getPendingInvitations()))
      .liveSessions(BigDecimal.valueOf(response.getLiveSessions()))
      .seatsAllocated(BigDecimal.valueOf(response.getSeatsAllocated()))
      .seatsInUse(BigDecimal.valueOf(response.getSeatsInUse()))
      .generatedAt(toOffsetDateTime(response.getGeneratedAt()));

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  public ResponseEntity<
    ApiResponse<FinanceSnapshotResponseDto>
  > getFinanceSnapshot(RequestContext context) {
    superAdminCheck.require(context);

    FinanceSnapshotResponse response = withMetadata(context).getFinanceSnapshot(
      GetFinanceSnapshotRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toFinanceSnapshotResponseDto(response))
    );
  }

  public ResponseEntity<
    ApiResponse<BillingEventsResponseDto>
  > listBillingEvents(RequestContext context, String from, String to) {
    superAdminCheck.require(context);
    requireDateRange(from, to);

    ListBillingEventsResponse response = withMetadata(
      context
    ).listBillingEvents(
      ListBillingEventsRequest.newBuilder().setFrom(from).setTo(to).build()
    );

    BillingEventsResponseDto data = new BillingEventsResponseDto()
      .points(
        response
          .getPointsList()
          .stream()
          .map(PlatformUsersRolesFinanceService::toBillingEventPointDto)
          .toList()
      )
      .currentlyOffboarded(
        response
          .getCurrentlyOffboardedList()
          .stream()
          .map(PlatformUsersRolesFinanceService::toBillingEventPointDto)
          .toList()
      )
      .observedEventTypes(response.getObservedEventTypesList());

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  /** {@code ISO_LOCAL_DATE} resolves strictly, so {@code 2026-02-30} throws. */
  static void requireDateRange(String from, String to) {
    LocalDate start;
    LocalDate end;
    try {
      start = LocalDate.parse(from);
      end = LocalDate.parse(to);
    } catch (DateTimeParseException notADate) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "from and to must be ISO dates (YYYY-MM-DD)"
      );
    }
    if (end.isBefore(start)) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "to must not be before from"
      );
    }
  }

  private static PageRequest toPageRequest(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String sortBy,
    String searchTerm
  ) {
    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }
    return pageRequest.build();
  }

  private static PlatformUserResponseDto toPlatformUserResponseDto(
    PlatformUserResponse row
  ) {
    return new PlatformUserResponseDto()
      .user(UserMapper.toUserResponseDto(row.getUser()))
      .organizationId(row.hasOrganizationId() ? row.getOrganizationId() : null)
      .organizationName(
        row.hasOrganizationName() ? row.getOrganizationName() : null
      )
      .roleNames(row.getRoleNamesList())
      .deletedAt(
        row.hasDeletedAt() ? toOffsetDateTime(row.getDeletedAt()) : null
      );
  }

  private static RoleResponseDto toRoleResponseDto(RoleResponse role) {
    return new RoleResponseDto()
      .id(role.getId())
      .name(role.getName())
      .description(role.hasDescription() ? role.getDescription() : null)
      .isSystemRole(role.getIsSystemRole())
      .userAssigned(BigDecimal.valueOf(role.getUserAssigned()))
      .permissionCodes(
        role
          .getPermissionCodesList()
          .stream()
          .map(RoleResponseDto.PermissionCodesEnum::fromValue)
          .toList()
      )
      .createdAt(toOffsetDateTime(role.getCreatedAt()))
      .updatedAt(toOffsetDateTime(role.getUpdatedAt()));
  }

  private static FinanceSnapshotResponseDto toFinanceSnapshotResponseDto(
    FinanceSnapshotResponse response
  ) {
    Map<String, BigDecimal> byStatus = response
      .getTenants()
      .getByStatusMap()
      .entrySet()
      .stream()
      .collect(
        Collectors.toMap(Map.Entry::getKey, entry ->
          BigDecimal.valueOf(entry.getValue())
        )
      );

    return new FinanceSnapshotResponseDto()
      .tenants(
        new FinanceTenantCountsResponseDto()
          .total(BigDecimal.valueOf(response.getTenants().getTotal()))
          .byStatus(byStatus)
      )
      .plans(
        response
          .getPlansList()
          .stream()
          .map(plan ->
            new FinancePlanMixResponseDto()
              .planId(plan.getPlanId())
              .planName(plan.getPlanName())
              .subscribers(BigDecimal.valueOf(plan.getSubscribers()))
              .seatsAllocated(BigDecimal.valueOf(plan.getSeatsAllocated()))
          )
          .toList()
      )
      .dunning(
        new FinanceDunningResponseDto()
          .pastDue(BigDecimal.valueOf(response.getDunning().getPastDue()))
          .tenants(
            response
              .getDunning()
              .getTenantsList()
              .stream()
              .map(tenant ->
                new DunningTenantResponseDto()
                  .id(tenant.getId())
                  .name(tenant.getName())
                  .updatedAt(toOffsetDateTime(tenant.getUpdatedAt()))
              )
              .toList()
          )
      )
      .revenue(
        new FinanceRevenueResponseDto()
          .available(response.getRevenue().getAvailable())
          .unavailableReason(
            response.getRevenue().hasUnavailableReason()
              ? response.getRevenue().getUnavailableReason()
              : null
          )
          .estimatedMrr(
            response.getRevenue().hasEstimatedMrr()
              ? BigDecimal.valueOf(response.getRevenue().getEstimatedMrr())
              : null
          )
          .currency(
            response.getRevenue().hasCurrency()
              ? response.getRevenue().getCurrency()
              : null
          )
          .activeSubscriptions(
            response.getRevenue().hasActiveSubscriptions()
              ? BigDecimal.valueOf(
                  response.getRevenue().getActiveSubscriptions()
                )
              : null
          )
          .computedAt(
            response.getRevenue().hasComputedAt()
              ? toOffsetDateTime(response.getRevenue().getComputedAt())
              : null
          )
          .excludes(response.getRevenue().getExcludesList())
      )
      .generatedAt(toOffsetDateTime(response.getGeneratedAt()));
  }

  private static BillingEventPointResponseDto toBillingEventPointDto(
    synapsedesk.auth.Platform.BillingEventPoint point
  ) {
    return new BillingEventPointResponseDto()
      .day(point.getDay())
      .eventType(point.getEventType())
      .count(BigDecimal.valueOf(point.getCount()));
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private PlatformServiceGrpc.PlatformServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}

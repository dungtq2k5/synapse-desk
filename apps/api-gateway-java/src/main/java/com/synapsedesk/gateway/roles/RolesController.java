package com.synapsedesk.gateway.roles;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.generated.api.RolesApi;
import com.synapsedesk.gateway.generated.model.AssignRoleUsersDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CreateRoleDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.RoleResponseDto;
import com.synapsedesk.gateway.generated.model.RolesControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.RolesControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.RolesControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.SetRolePermissionsDto;
import com.synapsedesk.gateway.generated.model.UpdateRoleDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.Role.AssignRoleUsersRequest;
import synapsedesk.auth.Role.CreateRoleRequest;
import synapsedesk.auth.Role.ListRolesRequest;
import synapsedesk.auth.Role.ListRolesResponse;
import synapsedesk.auth.Role.RevokeRoleUserRequest;
import synapsedesk.auth.Role.RoleIdRequest;
import synapsedesk.auth.Role.RoleResponse;
import synapsedesk.auth.Role.SetRolePermissionsRequest;
import synapsedesk.auth.Role.UpdateRoleRequest;
import synapsedesk.auth.RoleServiceGrpc;

/**
 * `RolesApi` — against auth-service's `RoleService`, on the same channel and
 * stub as `PermissionsApi` (`roles.controller.ts`, reproduced).
 *
 * <p>
 * <b>`list` is the one cached route</b>, keyed the same way
 * `DocumentsController` established: the RAW query string, not the
 * bound/defaulted method arguments — Node's `@Cacheable` reads
 * `request.query` before Nest fills defaults in, so keying off Java's
 * already-defaulted parameters would write a different key for the same
 * logical request whenever a client omits one. No `__visibility` segment
 * here (`varyBy: 'tenant'`, unlike `Documents`' `'caller'`).
 *
 * <p>
 * <b>No write here evicts the cache</b> — known gap 42. Node's
 * `@InvalidateCache(CACHE_SCOPES.roles)` has no Java equivalent yet, so a
 * role list read through this gateway can serve a stale entry for up to the
 * route's TTL after a write, exactly as the gap describes for every other
 * `@Cacheable` route ported so far.
 */
@RestController
public class RolesController implements RolesApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final String CACHE_SCOPE = "roles";
  private static final long LIST_CACHE_TTL_SECONDS = 5 * 60;

  private final RoleServiceGrpc.RoleServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CacheService cache;

  public RolesController(
    RoleServiceGrpc.RoleServiceBlockingStub stub,
    CurrentUser currentUser,
    CacheService cache
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cache = cache;
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<RolesControllerListV1200Response> rolesControllerListV1(
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeSystem
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    Map<String, String> rawParams = new TreeMap<>();
    CurrentRequest.request()
      .getParameterMap()
      .forEach((name, values) -> {
        if (values.length > 0 && !values[0].isEmpty()) {
          rawParams.put(name, values[0]);
        }
      });

    String key = cache.buildKey(
      context.organizationId(),
      CACHE_SCOPE,
      rawParams
    );

    RolesControllerListV1200Response envelope = cache.wrap(
      key,
      LIST_CACHE_TTL_SECONDS,
      RolesControllerListV1200Response.class,
      () -> {
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

        ListRolesResponse response = withMetadata(context).listRoles(
          ListRolesRequest.newBuilder()
            .setPage(pageRequest)
            .setIncludeSystem(Boolean.TRUE.equals(includeSystem))
            .build()
        );

        RolesControllerListV1200ResponseData data =
          new RolesControllerListV1200ResponseData()
            .items(
              response
                .getItemsList()
                .stream()
                .map(RolesController::toRoleResponseDto)
                .toList()
            )
            .meta(toMetaDto(response.getMeta()));

        return new RolesControllerListV1200Response()
          .success(true)
          .statusCode(BigDecimal.valueOf(200))
          .message("OK")
          .data(data);
      }
    );

    return ResponseEntity.ok(envelope);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerGetV1(
    String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RoleResponse response = withMetadata(context).getRole(
      RoleIdRequest.newBuilder().setId(id).build()
    );

    return okRole(response, "OK", 200);
  }

  /**
   * Gated on `role.create` ALONE, deliberately. The body also grants
   * permissions, so adding `role.permission.assign` here as well looks like
   * the stricter choice — but `@RequirePermission` is ANY-of, so it would
   * WEAKEN the gate to "either one". The escalation risk is closed in
   * auth-service instead: an actor cannot grant what they do not hold.
   */
  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_CREATE)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerCreateV1(
    CreateRoleDto createRoleDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateRoleRequest.Builder wire = CreateRoleRequest.newBuilder()
      .setName(createRoleDto.getName())
      .addAllPermissionCodes(
        createRoleDto
          .getPermissionCodes()
          .stream()
          .map(Object::toString)
          .toList()
      );
    if (createRoleDto.getDescription() != null) {
      wire.setDescription(createRoleDto.getDescription());
    }

    RoleResponse response = withMetadata(context).createRole(wire.build());

    return okRole(response, "OK", 201);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_UPDATE)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerUpdateV1(
    String id,
    UpdateRoleDto updateRoleDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateRoleRequest.Builder wire = UpdateRoleRequest.newBuilder().setId(id);
    if (updateRoleDto.getName() != null) {
      wire.setName(updateRoleDto.getName());
    }
    if (updateRoleDto.getDescription() != null) {
      wire.setDescription(updateRoleDto.getDescription());
    }

    RoleResponse response = withMetadata(context).updateRole(wire.build());

    return okRole(response, "OK", 200);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_DELETE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> rolesControllerRemoveV1(
    String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteRole(
      RoleIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Role deleted")
        .data(null)
    );
  }

  @Override
  @RequirePermission(PermissionCodesEnum.ROLE_PERMISSION_ASSIGN)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerSetPermissionsV1(
    String id,
    SetRolePermissionsDto setRolePermissionsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SetRolePermissionsRequest wire = SetRolePermissionsRequest.newBuilder()
      .setId(id)
      .addAllPermissionCodes(
        setRolePermissionsDto
          .getPermissionCodes()
          .stream()
          .map(Object::toString)
          .toList()
      )
      .build();

    RoleResponse response = withMetadata(context).setRolePermissions(wire);

    return okRole(response, "Permissions updated", 200);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerAssignUsersV1(
    String id,
    AssignRoleUsersDto assignRoleUsersDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    AssignRoleUsersRequest wire = AssignRoleUsersRequest.newBuilder()
      .setRoleId(id)
      .addAllUserIds(
        assignRoleUsersDto.getUserIds().stream().map(Object::toString).toList()
      )
      .build();

    RoleResponse response = withMetadata(context).assignRoleUsers(wire);

    return okRole(response, "Role assigned", 200);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<RolesControllerCreateV1201Response> rolesControllerRevokeUserV1(
    String id,
    String userId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RoleResponse response = withMetadata(context).revokeRoleUser(
      RevokeRoleUserRequest.newBuilder().setRoleId(id).setUserId(userId).build()
    );

    return okRole(response, "Role revoked", 200);
  }

  private static ResponseEntity<RolesControllerCreateV1201Response> okRole(
    RoleResponse response,
    String message,
    int status
  ) {
    return ResponseEntity.status(status).body(
      new RolesControllerCreateV1201Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(status))
        .message(message)
        .data(toRoleResponseDto(response))
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

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(
    synapsedesk.auth.Common.PageMeta meta
  ) {
    return new InvitationsControllerListV1200ResponseDataMeta(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
    );
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private RoleServiceGrpc.RoleServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}

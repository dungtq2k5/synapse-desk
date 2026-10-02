package com.synapsedesk.gateway.roles;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.AssignRoleUsersDto;
import com.synapsedesk.gateway.model.CreateRoleDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.RoleResponseDto;
import com.synapsedesk.gateway.model.SetRolePermissionsDto;
import com.synapsedesk.gateway.model.UpdateRoleDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.security.RequirePermission;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.PageMeta;
import com.synapsedesk.gateway.web.PagedData;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
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
 *
 * <p><b>Migrated off `RolesApi`.</b> `create` answers 201 —
 * `@ResponseStatus` is what tells springdoc that. `list`'s cache now goes
 * through {@link CacheService}'s {@code TypeReference} overload: the
 * generic `ApiResponse<PagedData<RoleResponseDto>>` envelope is the first
 * cached shape this gateway has cached where a bare {@code Class<T>} would
 * have erased `data` back to an untyped map on every cache HIT.
 */
@Tag(name = "Roles")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class RolesController {

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

  @RequestMapping(
    method = RequestMethod.GET,
    value = "/roles",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<
    ApiResponse<PagedData<RoleResponseDto>>
  > rolesControllerListV1(
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
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) String sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) String sortBy,
    @Valid @RequestParam(
      value = "includeSystem",
      required = false,
      defaultValue = "false"
    ) Boolean includeSystem
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

    ApiResponse<PagedData<RoleResponseDto>> envelope = cache.wrapTyped(
      key,
      LIST_CACHE_TTL_SECONDS,
      new tools.jackson.core.type.TypeReference<
        ApiResponse<PagedData<RoleResponseDto>>
      >() {},
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

        PagedData<RoleResponseDto> data = new PagedData<>(
          response
            .getItemsList()
            .stream()
            .map(RolesController::toRoleResponseDto)
            .toList(),
          PageMeta.from(response.getMeta())
        );

        return ApiResponse.of(200, "OK", data);
      }
    );

    return ResponseEntity.ok(envelope);
  }

  @GetMapping(value = "/roles/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.ROLE_READ)
  public ResponseEntity<ApiResponse<RoleResponseDto>> rolesControllerGetV1(
    @PathVariable("id") String id
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
  @PostMapping(
    value = "/roles",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.ROLE_CREATE)
  public ResponseEntity<ApiResponse<RoleResponseDto>> rolesControllerCreateV1(
    @Valid @RequestBody CreateRoleDto createRoleDto
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

  @PatchMapping(
    value = "/roles/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.ROLE_UPDATE)
  public ResponseEntity<ApiResponse<RoleResponseDto>> rolesControllerUpdateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdateRoleDto updateRoleDto
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

  @DeleteMapping(value = "/roles/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.ROLE_DELETE)
  public ResponseEntity<ApiResponse<Void>> rolesControllerRemoveV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).deleteRole(
      RoleIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(ApiResponse.of(200, "Role deleted", null));
  }

  @PutMapping(
    value = "/roles/{id}/permissions",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.ROLE_PERMISSION_ASSIGN)
  public ResponseEntity<
    ApiResponse<RoleResponseDto>
  > rolesControllerSetPermissionsV1(
    @PathVariable("id") String id,
    @Valid @RequestBody SetRolePermissionsDto setRolePermissionsDto
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

  @PostMapping(
    value = "/roles/{id}/users",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<
    ApiResponse<RoleResponseDto>
  > rolesControllerAssignUsersV1(
    @PathVariable("id") String id,
    @Valid @RequestBody AssignRoleUsersDto assignRoleUsersDto
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

  @DeleteMapping(
    value = "/roles/{id}/users/{userId}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404", "409" })
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<
    ApiResponse<RoleResponseDto>
  > rolesControllerRevokeUserV1(
    @PathVariable("id") String id,
    @PathVariable("userId") String userId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RoleResponse response = withMetadata(context).revokeRoleUser(
      RevokeRoleUserRequest.newBuilder().setRoleId(id).setUserId(userId).build()
    );

    return okRole(response, "Role revoked", 200);
  }

  private static ResponseEntity<ApiResponse<RoleResponseDto>> okRole(
    RoleResponse response,
    String message,
    int status
  ) {
    return ResponseEntity.status(status).body(
      ApiResponse.of(status, message, toRoleResponseDto(response))
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

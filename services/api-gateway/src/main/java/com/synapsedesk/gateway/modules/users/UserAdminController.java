package com.synapsedesk.gateway.modules.users;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.cache.EvictsCache;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PageMeta;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.RawJsonBody;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.model.CreateUserDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.DepartmentAssignmentDto;
import com.synapsedesk.gateway.model.LockUserDto;
import com.synapsedesk.gateway.model.RevokedSessionCountResponseDto;
import com.synapsedesk.gateway.model.SetUserDepartmentsDto;
import com.synapsedesk.gateway.model.SetUserRolesDto;
import com.synapsedesk.gateway.model.UntrustedDeviceCountResponseDto;
import com.synapsedesk.gateway.model.UpdateUserDto;
import com.synapsedesk.gateway.model.UserPermissionsResponseDto;
import com.synapsedesk.gateway.model.UserSummaryResponseDto;
import com.synapsedesk.gateway.modules.auth.UserMapper;
import com.synapsedesk.gateway.modules.users.dto.rest.UserSortField;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.User.CreateUserRequest;
import synapsedesk.auth.User.CreateUserResponse;
import synapsedesk.auth.User.DeleteUserResponse;
import synapsedesk.auth.User.ListUsersRequest;
import synapsedesk.auth.User.ListUsersResponse;
import synapsedesk.auth.User.LockUserRequest;
import synapsedesk.auth.User.LockUserResponse;
import synapsedesk.auth.User.ResetUserTwoFactorResponse;
import synapsedesk.auth.User.SetUserDepartmentsRequest;
import synapsedesk.auth.User.SetUserRolesRequest;
import synapsedesk.auth.User.UpdateUserRequest;
import synapsedesk.auth.User.UserIdRequest;
import synapsedesk.auth.User.UserSummaryResponse;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `UserAdminApi` — tenant administration of OTHER users, against
 * auth-service's `UserService`. Same channel/stub bean as `UsersApi`
 * (`GrpcChannels.userServiceStub`).
 *
 * <p>The self / last-admin 409 and the role no-escalation rule are NOT
 * gateway code — both live entirely in auth-service, so
 * this forwards and lets the gRPC error surface (`GrpcStatusMapping` already
 * turns `ABORTED`/`ALREADY_EXISTS` into 409). The one guard that IS gateway
 * code is `includeDeleted`, because it widens a route past what
 * `@RequirePermission`'s OR semantics can express.
 *
 * <p><b>Migrated off `UserAdminApi`.</b> `create` answers 201 —
 * {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "User Admin")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class UserAdminController {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final RawJsonBody rawBody;

  public UserAdminController(
    UserServiceGrpc.UserServiceBlockingStub stub,
    CurrentUser currentUser,
    RawJsonBody rawBody
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.rawBody = rawBody;
  }

  private UserServiceGrpc.UserServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  @GetMapping(value = "/users", produces = { "application/json" })
  @ApiErrors({ "401", "403" })
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<
    ApiResponse<PagedData<UserSummaryResponseDto>>
  > userAdminControllerListV1(
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
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) UserSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "departmentId",
      required = false
    ) @Nullable UUID departmentId,
    @Valid @RequestParam(
      value = "roleId",
      required = false
    ) @Nullable UUID roleId,
    @Valid @RequestParam(
      value = "isLocked",
      required = false
    ) @Nullable Boolean isLocked
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Not expressible as a second `@RequirePermission` code: that decorator is
    // ANY-of, so adding one would WIDEN the route instead of narrowing it.
    if (
      Boolean.TRUE.equals(includeDeleted) &&
      !context.permissionCodes().contains("user.delete")
    ) {
      throw new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        "Viewing deactivated users requires the user.delete permission"
      );
    }

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy.name())
      .setSortOrder(
        sortOrder == SortDirection.DESC
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListUsersRequest.Builder wire = ListUsersRequest.newBuilder().setPage(
      pageRequest
    );
    if (departmentId != null) {
      wire.setDepartmentId(departmentId.toString());
    }
    if (roleId != null) {
      wire.setRoleId(roleId.toString());
    }
    if (isLocked != null) {
      wire.setIsLocked(isLocked);
    }
    if (includeDeleted != null) {
      wire.setIncludeDeleted(includeDeleted);
    }

    ListUsersResponse response = withMetadata(context).listUsers(wire.build());

    PagedData<UserSummaryResponseDto> data = new PagedData<>(
      response.getItemsList().stream().map(UserAdminController::toDto).toList(),
      PageMeta.from(response.getMeta())
    );

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @GetMapping(value = "/users/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerGetV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    UserSummaryResponse response = withMetadata(context).getUser(
      UserIdRequest.newBuilder().setId(id).build()
    );
    return okSummary(response, "OK", HttpStatus.OK);
  }

  @GetMapping(
    value = "/users/{id}/permissions",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<
    ApiResponse<UserPermissionsResponseDto>
  > userAdminControllerGetPermissionsV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    var response = withMetadata(context).getUserPermissions(
      UserIdRequest.newBuilder().setId(id).build()
    );
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new UserPermissionsResponseDto(response.getPermissionCodesList())
      )
    );
  }

  @PostMapping(
    value = "/users",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.USER_CREATE)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerCreateV1(
    @Valid @RequestBody CreateUserDto createUserDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    CreateUserRequest.Builder wire = CreateUserRequest.newBuilder()
      .setEmail(createUserDto.getEmail())
      .setFullName(createUserDto.getFullName())
      .addAllRoleIds(
        createUserDto.getRoleIds().stream().map(Object::toString).toList()
      )
      .addAllDepartmentIds(
        createUserDto.getDepartmentIds().stream().map(Object::toString).toList()
      );
    UUID primaryDepartmentId = createUserDto.getPrimaryDepartmentId();
    if (primaryDepartmentId != null) {
      wire.setPrimaryDepartmentId(primaryDepartmentId.toString());
    }
    CreateUserResponse response = withMetadata(context).createUser(
      wire.build()
    );
    return okSummary(response.getUser(), "OK", HttpStatus.CREATED);
  }

  @PatchMapping(
    value = "/users/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_UPDATE)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerUpdateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdateUserDto updateUserDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    UpdateUserRequest.Builder wire = UpdateUserRequest.newBuilder().setId(id);
    if (updateUserDto.getFullName() != null) {
      wire.setFullName(updateUserDto.getFullName());
    }
    // `dob === null` clears it (empty string on the wire); `dob === undefined`
    // (here: field simply absent from the JSON body) leaves it unchanged. The
    // DTO reads both as null, so the raw body says which the client sent.
    if (updateUserDto.getDob() != null) {
      wire.setDob(updateUserDto.getDob());
    } else if (rawBody.isNull("dob")) {
      wire.setDob("");
    }
    var gender = updateUserDto.getGender();
    if (gender != null) {
      wire.setGender(Gender.valueOf("GENDER_" + gender.getValue()));
    } else if (rawBody.isNull("gender")) {
      wire.setGender(Gender.GENDER_UNSPECIFIED);
    }
    // Like `dob`: `null` clears it, as the empty string auth-service reads as
    // "no number".
    if (updateUserDto.getPhoneNumber() != null) {
      wire.setPhoneNumber(updateUserDto.getPhoneNumber());
    } else if (rawBody.isNull("phoneNumber")) {
      wire.setPhoneNumber("");
    }
    UserSummaryResponse response = withMetadata(context).updateUser(
      wire.build()
    );
    return okSummary(response, "OK", HttpStatus.OK);
  }

  // Removing a user releases the roles they held, which the cached role list
  // counts (`userAssigned`). Their department memberships are kept, so
  // `memberCount` does not change.
  @EvictsCache("roles")
  @DeleteMapping(value = "/users/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_DELETE)
  public ResponseEntity<
    ApiResponse<RevokedSessionCountResponseDto>
  > userAdminControllerRemoveV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    DeleteUserResponse response = withMetadata(context).deleteUser(
      UserIdRequest.newBuilder().setId(id).build()
    );
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "User deactivated",
        new RevokedSessionCountResponseDto(
          BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  @PostMapping(value = "/users/{id}/restore", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_DELETE)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerRestoreV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    UserSummaryResponse response = withMetadata(context).restoreUser(
      UserIdRequest.newBuilder().setId(id).build()
    );
    return okSummary(response, "User restored", HttpStatus.OK);
  }

  @PostMapping(
    value = "/users/{id}/lock",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_LOCK)
  public ResponseEntity<
    ApiResponse<RevokedSessionCountResponseDto>
  > userAdminControllerLockV1(
    @PathVariable("id") String id,
    @Valid @RequestBody LockUserDto lockUserDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    LockUserRequest.Builder wire = LockUserRequest.newBuilder()
      .setId(id)
      .setReason(lockUserDto.getReason());
    if (lockUserDto.getLockedUntil() != null) {
      Instant instant = lockUserDto.getLockedUntil().toInstant();
      wire.setLockedUntil(
        com.google.protobuf.Timestamp.newBuilder()
          .setSeconds(instant.getEpochSecond())
          .setNanos(instant.getNano())
          .build()
      );
    }
    LockUserResponse response = withMetadata(context).lockUser(wire.build());
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "User locked",
        new RevokedSessionCountResponseDto(
          BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  @PostMapping(value = "/users/{id}/unlock", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_LOCK)
  public ResponseEntity<ApiResponse<Void>> userAdminControllerUnlockV1(
    @PathVariable("id") String id
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    withMetadata(context).unlockUser(
      UserIdRequest.newBuilder().setId(id).build()
    );
    return ResponseEntity.ok(ApiResponse.of(200, "User unlocked", null));
  }

  @PostMapping(
    value = "/users/{id}/2fa/reset",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_2FA_RESET)
  public ResponseEntity<
    ApiResponse<UntrustedDeviceCountResponseDto>
  > userAdminControllerResetTwoFactorV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    ResetUserTwoFactorResponse response = withMetadata(
      context
    ).resetUserTwoFactor(UserIdRequest.newBuilder().setId(id).build());
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Two-factor authentication reset",
        new UntrustedDeviceCountResponseDto(
          BigDecimal.valueOf(response.getUntrustedDeviceCount())
        )
      )
    );
  }

  @EvictsCache("roles")
  @PutMapping(
    value = "/users/{id}/roles",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerSetRolesV1(
    @PathVariable("id") String id,
    @Valid @RequestBody SetUserRolesDto setUserRolesDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    SetUserRolesRequest wire = SetUserRolesRequest.newBuilder()
      .setId(id)
      .addAllRoleIds(
        setUserRolesDto.getRoleIds().stream().map(Object::toString).toList()
      )
      .build();
    UserSummaryResponse response = withMetadata(context).setUserRoles(wire);
    return okSummary(response, "Roles updated", HttpStatus.OK);
  }

  @EvictsCache("departments")
  @PutMapping(
    value = "/users/{id}/departments",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<
    ApiResponse<UserSummaryResponseDto>
  > userAdminControllerSetDepartmentsV1(
    @PathVariable("id") String id,
    @Valid @RequestBody SetUserDepartmentsDto setUserDepartmentsDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());
    SetUserDepartmentsRequest wire = SetUserDepartmentsRequest.newBuilder()
      .setId(id)
      .addAllDepartments(
        setUserDepartmentsDto
          .getDepartments()
          .stream()
          .map(UserAdminController::toDepartmentAssignment)
          .toList()
      )
      .build();
    UserSummaryResponse response = withMetadata(context).setUserDepartments(
      wire
    );
    return okSummary(response, "Departments updated", HttpStatus.OK);
  }

  private static ResponseEntity<ApiResponse<UserSummaryResponseDto>> okSummary(
    UserSummaryResponse response,
    String message,
    HttpStatus status
  ) {
    return ResponseEntity.status(status).body(
      ApiResponse.of(status.value(), message, toDto(response))
    );
  }

  private static UserSummaryResponseDto toDto(UserSummaryResponse summary) {
    return new UserSummaryResponseDto(
      UserMapper.toUserResponseDto(summary.getUser()),
      summary.getRoleIdsList(),
      summary.getRoleNamesList(),
      summary.getDepartmentIdsList(),
      summary.hasDeletedAt() ? toOffsetDateTime(summary.getDeletedAt()) : null,
      summary.hasDeletedByName() ? summary.getDeletedByName() : null
    );
  }

  private static synapsedesk.auth.User.DepartmentAssignment toDepartmentAssignment(
    DepartmentAssignmentDto dto
  ) {
    return synapsedesk.auth.User.DepartmentAssignment.newBuilder()
      .setDepartmentId(dto.getDepartmentId().toString())
      .setIsPrimary(dto.getIsPrimary())
      .build();
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}

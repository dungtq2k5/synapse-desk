package com.synapsedesk.gateway.users;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.generated.api.UserAdminApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CreateUserDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.DepartmentAssignmentDto;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.LockUserDto;
import com.synapsedesk.gateway.generated.model.RevokedSessionCountResponseDto;
import com.synapsedesk.gateway.generated.model.SetUserDepartmentsDto;
import com.synapsedesk.gateway.generated.model.SetUserRolesDto;
import com.synapsedesk.gateway.generated.model.UntrustedDeviceCountResponseDto;
import com.synapsedesk.gateway.generated.model.UpdateUserDto;
import com.synapsedesk.gateway.generated.model.UserAdminControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.UserAdminControllerGetPermissionsV1200Response;
import com.synapsedesk.gateway.generated.model.UserAdminControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.UserAdminControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.UserAdminControllerRemoveV1200Response;
import com.synapsedesk.gateway.generated.model.UserAdminControllerResetTwoFactorV1200Response;
import com.synapsedesk.gateway.generated.model.UserPermissionsResponseDto;
import com.synapsedesk.gateway.generated.model.UserSummaryResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.auth.User.CreateUserRequest;
import synapsedesk.auth.User.CreateUserResponse;
import synapsedesk.auth.User.DeleteUserResponse;
import synapsedesk.auth.User.LockUserRequest;
import synapsedesk.auth.User.LockUserResponse;
import synapsedesk.auth.User.ListUsersRequest;
import synapsedesk.auth.User.ListUsersResponse;
import synapsedesk.auth.User.ResetUserTwoFactorResponse;
import synapsedesk.auth.User.SetUserDepartmentsRequest;
import synapsedesk.auth.User.SetUserRolesRequest;
import synapsedesk.auth.User.UpdateUserRequest;
import synapsedesk.auth.User.UserIdRequest;
import synapsedesk.auth.User.UserSummaryResponse;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `UserAdminApi` — tenant administration of OTHER users, against
 * auth-service's `UserService` (`user-admin.controller.ts` reproduced). Same
 * channel/stub bean as `UsersApi` (`GrpcChannels.userServiceStub`).
 *
 * <p>The self / last-admin 409 and the role no-escalation rule are NOT
 * gateway code on the Node side — both live entirely in auth-service, so
 * this forwards and lets the gRPC error surface (`GrpcStatusMapping` already
 * turns `ABORTED`/`ALREADY_EXISTS` into 409). The one guard that IS gateway
 * code is `includeDeleted`, because it widens a route past what
 * `@RequirePermission`'s OR semantics can express.
 */
@RestController
public class UserAdminController implements UserAdminApi {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public UserAdminController(UserServiceGrpc.UserServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private UserServiceGrpc.UserServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<UserAdminControllerListV1200Response> userAdminControllerListV1(
      BigDecimal page,
      BigDecimal limit,
      String sortOrder,
      String searchTerm,
      String sortBy,
      Boolean includeDeleted,
      java.util.UUID departmentId,
      java.util.UUID roleId,
      Boolean isLocked) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    // Not expressible as a second `@RequirePermission` code: that decorator is
    // ANY-of, so adding one would WIDEN the route instead of narrowing it.
    if (Boolean.TRUE.equals(includeDeleted) && !context.permissionCodes().contains("user.delete")) {
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "Viewing deactivated users requires the user.delete permission");
    }

    PageRequest.Builder pageRequest =
        PageRequest.newBuilder()
            .setPage(page.intValue())
            .setLimit(limit.intValue())
            .setSortBy(sortBy)
            .setSortOrder("DESC".equalsIgnoreCase(sortOrder) ? SortOrder.SORT_ORDER_DESC : SortOrder.SORT_ORDER_ASC);
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListUsersRequest.Builder wire = ListUsersRequest.newBuilder().setPage(pageRequest);
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

    UserAdminControllerListV1200ResponseData data =
        new UserAdminControllerListV1200ResponseData()
            .items(response.getItemsList().stream().map(UserAdminController::toDto).toList())
            .meta(toMetaDto(response.getMeta()));

    return ResponseEntity.ok(
        new UserAdminControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerGetV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UserSummaryResponse response = withMetadata(context).getUser(UserIdRequest.newBuilder().setId(id).build());

    return okSummary(response, "OK", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_READ)
  public ResponseEntity<UserAdminControllerGetPermissionsV1200Response> userAdminControllerGetPermissionsV1(
      String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).getUserPermissions(UserIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new UserAdminControllerGetPermissionsV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new UserPermissionsResponseDto(response.getPermissionCodesList())));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_CREATE)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerCreateV1(
      CreateUserDto createUserDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CreateUserRequest.Builder wire =
        CreateUserRequest.newBuilder()
            .setEmail(createUserDto.getEmail())
            .setFullName(createUserDto.getFullName())
            .addAllRoleIds(createUserDto.getRoleIds().stream().map(Object::toString).toList())
            .addAllDepartmentIds(createUserDto.getDepartmentIds().stream().map(Object::toString).toList());
    if (createUserDto.getPrimaryDepartmentId() != null) {
      wire.setPrimaryDepartmentId(createUserDto.getPrimaryDepartmentId().toString());
    }

    CreateUserResponse response = withMetadata(context).createUser(wire.build());

    return okSummary(response.getUser(), "OK", HttpStatus.CREATED);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_UPDATE)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerUpdateV1(
      String id, UpdateUserDto updateUserDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateUserRequest.Builder wire = UpdateUserRequest.newBuilder().setId(id);
    if (updateUserDto.getFullName() != null) {
      wire.setFullName(updateUserDto.getFullName());
    }
    // `dob === null` clears it (empty string on the wire); `dob === undefined`
    // (here: field simply absent from the JSON body) leaves it unchanged —
    // `toProfileFields`, reproduced.
    if (updateUserDto.getDob() != null) {
      wire.setDob(updateUserDto.getDob());
    }
    if (updateUserDto.getGender() != null) {
      wire.setGender(Gender.valueOf("GENDER_" + updateUserDto.getGender().getValue()));
    }
    // Node's own `update()` does `dto.phoneNumber ?? undefined`, which collapses
    // an explicit `null` to "leave unchanged" same as an absent field — so
    // `phoneNumber` cannot actually be cleared through this route on either
    // side. Reproduced as-is rather than fixed: fixing it here would diverge
    // Java's behaviour from Node's.
    if (updateUserDto.getPhoneNumber() != null) {
      wire.setPhoneNumber(updateUserDto.getPhoneNumber());
    }

    UserSummaryResponse response = withMetadata(context).updateUser(wire.build());

    return okSummary(response, "OK", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_DELETE)
  public ResponseEntity<UserAdminControllerRemoveV1200Response> userAdminControllerRemoveV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    DeleteUserResponse response = withMetadata(context).deleteUser(UserIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new UserAdminControllerRemoveV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("User deactivated")
            .data(new RevokedSessionCountResponseDto(BigDecimal.valueOf(response.getRevokedSessionCount()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_DELETE)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerRestoreV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UserSummaryResponse response = withMetadata(context).restoreUser(UserIdRequest.newBuilder().setId(id).build());

    return okSummary(response, "User restored", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_LOCK)
  public ResponseEntity<UserAdminControllerRemoveV1200Response> userAdminControllerLockV1(
      String id, LockUserDto lockUserDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    LockUserRequest.Builder wire = LockUserRequest.newBuilder().setId(id).setReason(lockUserDto.getReason());
    if (lockUserDto.getLockedUntil() != null) {
      Instant instant = Instant.parse(lockUserDto.getLockedUntil());
      wire.setLockedUntil(
          com.google.protobuf.Timestamp.newBuilder()
              .setSeconds(instant.getEpochSecond())
              .setNanos(instant.getNano())
              .build());
    }

    LockUserResponse response = withMetadata(context).lockUser(wire.build());

    return ResponseEntity.ok(
        new UserAdminControllerRemoveV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("User locked")
            .data(new RevokedSessionCountResponseDto(BigDecimal.valueOf(response.getRevokedSessionCount()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_LOCK)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> userAdminControllerUnlockV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(context).unlockUser(UserIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("User unlocked")
            .data(null));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_2FA_RESET)
  public ResponseEntity<UserAdminControllerResetTwoFactorV1200Response> userAdminControllerResetTwoFactorV1(
      String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ResetUserTwoFactorResponse response =
        withMetadata(context).resetUserTwoFactor(UserIdRequest.newBuilder().setId(id).build());

    return ResponseEntity.ok(
        new UserAdminControllerResetTwoFactorV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Two-factor authentication reset")
            .data(new UntrustedDeviceCountResponseDto(BigDecimal.valueOf(response.getUntrustedDeviceCount()))));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_ROLE_ASSIGN)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerSetRolesV1(
      String id, SetUserRolesDto setUserRolesDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SetUserRolesRequest wire =
        SetUserRolesRequest.newBuilder()
            .setId(id)
            .addAllRoleIds(setUserRolesDto.getRoleIds().stream().map(Object::toString).toList())
            .build();

    UserSummaryResponse response = withMetadata(context).setUserRoles(wire);

    return okSummary(response, "Roles updated", HttpStatus.OK);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.DEPARTMENT_MEMBER_ASSIGN)
  public ResponseEntity<UserAdminControllerCreateV1201Response> userAdminControllerSetDepartmentsV1(
      String id, SetUserDepartmentsDto setUserDepartmentsDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    SetUserDepartmentsRequest wire =
        SetUserDepartmentsRequest.newBuilder()
            .setId(id)
            .addAllDepartments(
                setUserDepartmentsDto.getDepartments().stream().map(UserAdminController::toDepartmentAssignment).toList())
            .build();

    UserSummaryResponse response = withMetadata(context).setUserDepartments(wire);

    return okSummary(response, "Departments updated", HttpStatus.OK);
  }

  private static ResponseEntity<UserAdminControllerCreateV1201Response> okSummary(
      UserSummaryResponse response, String message, HttpStatus status) {
    return ResponseEntity.status(status)
        .body(
            new UserAdminControllerCreateV1201Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(status.value()))
                .message(message)
                .data(toDto(response)));
  }

  private static UserSummaryResponseDto toDto(UserSummaryResponse summary) {
    return new UserSummaryResponseDto(
        UserMapper.toUserResponseDto(summary.getUser()),
        summary.getRoleIdsList(),
        summary.getRoleNamesList(),
        summary.getDepartmentIdsList(),
        summary.hasDeletedAt() ? toOffsetDateTime(summary.getDeletedAt()) : null,
        summary.hasDeletedByName() ? summary.getDeletedByName() : null);
  }

  private static synapsedesk.auth.User.DepartmentAssignment toDepartmentAssignment(DepartmentAssignmentDto dto) {
    return synapsedesk.auth.User.DepartmentAssignment.newBuilder()
        .setDepartmentId(dto.getDepartmentId().toString())
        .setIsPrimary(dto.getIsPrimary())
        .build();
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(PageMeta meta) {
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
}

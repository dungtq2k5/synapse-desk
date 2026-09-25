package com.synapsedesk.gateway.users;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.generated.api.UsersApi;
import com.synapsedesk.gateway.generated.model.ConfirmAvatarDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.PresignAvatarDto;
import com.synapsedesk.gateway.generated.model.PresignAvatarResponseDto;
import com.synapsedesk.gateway.generated.model.UpdateOwnProfileDto;
import com.synapsedesk.gateway.generated.model.UserResponseDto;
import com.synapsedesk.gateway.generated.model.UsersControllerGetCurrentUserV1200Response;
import com.synapsedesk.gateway.generated.model.UsersControllerPresignAvatarV1200Response;
import com.synapsedesk.gateway.generated.model.UsersControllerUpdateOwnProfileV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;

import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.User.ConfirmAvatarUploadRequest;
import synapsedesk.auth.User.CurrentUserResponse;
import synapsedesk.auth.User.DeleteAvatarRequest;
import synapsedesk.auth.User.GetCurrentUserRequest;
import synapsedesk.auth.User.PresignAvatarUploadRequest;
import synapsedesk.auth.User.PresignAvatarUploadResponse;
import synapsedesk.auth.User.UpdateOwnProfileRequest;
import synapsedesk.auth.UserServiceGrpc;

/**
 * `UsersApi`, implemented against `UserService` — the smallest real
 * controller behind a session, and the one four existing harness rows already
 * exercise. All five methods are thin forwards to auth-service, exactly as
 * `users.service.ts` is.
 */
@RestController
public class UsersController implements UsersApi {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public UsersController(UserServiceGrpc.UserServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private UserServiceGrpc.UserServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
            io.grpc.stub.MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<UsersControllerGetCurrentUserV1200Response> usersControllerGetCurrentUserV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CurrentUserResponse response =
        withMetadata(context)
            .getCurrentUser(GetCurrentUserRequest.newBuilder().setUserId(context.sub()).build());

    List<PermissionCodesEnum> permissions =
        response.getPermissionCodesList().stream().map(PermissionCodesEnum::fromValue).toList();
    List<UUID> departments =
        response.getDepartmentIdsList().stream().map(UUID::fromString).toList();

    CurrentUserResponseDto data =
        new CurrentUserResponseDto()
            .user(UserMapper.toUserResponseDto(response.getUser()))
            .permissionCodes(permissions)
            .departmentIds(departments);

    return ResponseEntity.ok(
        new UsersControllerGetCurrentUserV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<UsersControllerUpdateOwnProfileV1200Response> usersControllerUpdateOwnProfileV1(
      UpdateOwnProfileDto updateOwnProfileDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateOwnProfileRequest.Builder wire = UpdateOwnProfileRequest.newBuilder();
    if (updateOwnProfileDto.getFullName() != null) {
      wire.setFullName(updateOwnProfileDto.getFullName());
    }
    if (updateOwnProfileDto.getDob() != null) {
      wire.setDob(updateOwnProfileDto.getDob());
    }
    if (updateOwnProfileDto.getGender() != null) {
      // FIXME A "NullPointerException" could be thrown; "getGender()" can return null. [+2 locations]
      wire.setGender(Gender.valueOf("GENDER_" + updateOwnProfileDto.getGender().getValue()));
    }

    synapsedesk.auth.Common.UserResponse response =
        withMetadata(context).updateOwnProfile(wire.build());

    return okUser(response, "Profile updated");
  }

  @Override
  public ResponseEntity<UsersControllerPresignAvatarV1200Response> usersControllerPresignAvatarV1(
      PresignAvatarDto presignAvatarDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignAvatarUploadResponse response =
        withMetadata(context)
            .presignAvatarUpload(
                PresignAvatarUploadRequest.newBuilder()
                    .setContentType(presignAvatarDto.getContentType().getValue())
                    .setSizeBytes(presignAvatarDto.getSizeBytes().longValue())
                    .setOriginalFileName(presignAvatarDto.getFileName())
                    .build());

    PresignAvatarResponseDto data =
        new PresignAvatarResponseDto()
            .uploadUrl(response.getUploadUrl())
            .objectPath(response.getObjectPath())
            .expiresAt(toOffsetDateTime(response.getExpiresAt()));

    return ResponseEntity.ok(
        new UsersControllerPresignAvatarV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<UsersControllerUpdateOwnProfileV1200Response> usersControllerConfirmAvatarV1(
      ConfirmAvatarDto confirmAvatarDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    synapsedesk.auth.Common.UserResponse response =
        withMetadata(context)
            .confirmAvatarUpload(
                ConfirmAvatarUploadRequest.newBuilder()
                    .setObjectPath(confirmAvatarDto.getObjectPath())
                    .build());

    return okUser(response, "Avatar confirmed");
  }

  @Override
  public ResponseEntity<UsersControllerUpdateOwnProfileV1200Response> usersControllerDeleteAvatarV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    synapsedesk.auth.Common.UserResponse response =
        withMetadata(context).deleteAvatar(DeleteAvatarRequest.newBuilder().build());

    return okUser(response, "Avatar deleted");
  }

  private ResponseEntity<UsersControllerUpdateOwnProfileV1200Response> okUser(
      synapsedesk.auth.Common.UserResponse response, String message) {
    UserResponseDto data = UserMapper.toUserResponseDto(response);

    return ResponseEntity.ok(
        new UsersControllerUpdateOwnProfileV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message(message)
            .data(data));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos())
        .atOffset(ZoneOffset.UTC);
  }
}

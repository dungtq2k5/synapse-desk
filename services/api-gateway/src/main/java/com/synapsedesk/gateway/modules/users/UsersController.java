package com.synapsedesk.gateway.modules.users;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.dto.UserResponseDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.RawJsonBody;
import com.synapsedesk.gateway.modules.auth.UserMapper;
import com.synapsedesk.gateway.modules.users.dto.rest.ConfirmAvatarDto;
import com.synapsedesk.gateway.modules.users.dto.rest.PresignAvatarDto;
import com.synapsedesk.gateway.modules.users.dto.rest.PresignAvatarResponseDto;
import com.synapsedesk.gateway.modules.users.dto.rest.UpdateOwnProfileDto;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
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
 *
 * <p><b>Migrated off `UsersApi`.</b>
 */
@Tag(name = "Users")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class UsersController {

  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final RawJsonBody rawBody;

  public UsersController(
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
        io.grpc.stub.MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(context)
        )
      );
  }

  // The caller's own profile: how a frozen member is told why they cannot proceed.
  @OrgAccessKind(OrgAccess.AUTH)
  @GetMapping(value = "/users/me", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<CurrentUserResponseDto>
  > usersControllerGetCurrentUserV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    CurrentUserResponse response = withMetadata(context).getCurrentUser(
      GetCurrentUserRequest.newBuilder().setUserId(context.sub()).build()
    );

    List<PermissionCodesEnum> permissions = response
      .getPermissionCodesList()
      .stream()
      .map(PermissionCodesEnum::fromValue)
      .toList();
    List<UUID> departments = response
      .getDepartmentIdsList()
      .stream()
      .map(UUID::fromString)
      .toList();

    CurrentUserResponseDto data = new CurrentUserResponseDto()
      .user(UserMapper.toUserResponseDto(response.getUser()))
      .permissionCodes(permissions)
      .departmentIds(departments);

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PatchMapping(
    value = "/users/me",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<UserResponseDto>
  > usersControllerUpdateOwnProfileV1(
    @Valid @RequestBody UpdateOwnProfileDto updateOwnProfileDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    UpdateOwnProfileRequest.Builder wire = UpdateOwnProfileRequest.newBuilder();
    if (updateOwnProfileDto.getFullName() != null) {
      wire.setFullName(updateOwnProfileDto.getFullName());
    }
    // A literal `null` clears the field (an empty dob, an UNSPECIFIED gender) and
    // leaving it out leaves it alone; the DTO reads both as null, the raw body tells.
    if (updateOwnProfileDto.getDob() != null) {
      wire.setDob(updateOwnProfileDto.getDob());
    } else if (rawBody.isNull("dob")) {
      wire.setDob("");
    }
    UpdateOwnProfileDto.GenderEnum gender = updateOwnProfileDto.getGender();
    if (gender != null) {
      wire.setGender(Gender.valueOf("GENDER_" + gender.getValue()));
    } else if (rawBody.isNull("gender")) {
      wire.setGender(Gender.GENDER_UNSPECIFIED);
    }

    synapsedesk.auth.Common.UserResponse response = withMetadata(
      context
    ).updateOwnProfile(wire.build());

    return okUser(response, "Profile updated");
  }

  @PostMapping(
    value = "/users/me/avatar/upload-url",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<PresignAvatarResponseDto>
  > usersControllerPresignAvatarV1(
    @Valid @RequestBody PresignAvatarDto presignAvatarDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PresignAvatarUploadResponse response = withMetadata(
      context
    ).presignAvatarUpload(
      PresignAvatarUploadRequest.newBuilder()
        .setContentType(presignAvatarDto.getContentType().getValue())
        .setSizeBytes(presignAvatarDto.getSizeBytes().longValue())
        .setOriginalFileName(presignAvatarDto.getFileName())
        .build()
    );

    PresignAvatarResponseDto data = new PresignAvatarResponseDto()
      .uploadUrl(response.getUploadUrl())
      .objectPath(response.getObjectPath())
      .expiresAt(toOffsetDateTime(response.getExpiresAt()));

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(
    value = "/users/me/avatar/confirm",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<UserResponseDto>
  > usersControllerConfirmAvatarV1(
    @Valid @RequestBody ConfirmAvatarDto confirmAvatarDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    synapsedesk.auth.Common.UserResponse response = withMetadata(
      context
    ).confirmAvatarUpload(
      ConfirmAvatarUploadRequest.newBuilder()
        .setObjectPath(confirmAvatarDto.getObjectPath())
        .build()
    );

    return okUser(response, "Avatar confirmed");
  }

  @DeleteMapping(value = "/users/me/avatar", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<UserResponseDto>
  > usersControllerDeleteAvatarV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    synapsedesk.auth.Common.UserResponse response = withMetadata(
      context
    ).deleteAvatar(DeleteAvatarRequest.newBuilder().build());

    return okUser(response, "Avatar deleted");
  }

  private ResponseEntity<ApiResponse<UserResponseDto>> okUser(
    synapsedesk.auth.Common.UserResponse response,
    String message
  ) {
    return ResponseEntity.ok(
      ApiResponse.of(200, message, UserMapper.toUserResponseDto(response))
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
}

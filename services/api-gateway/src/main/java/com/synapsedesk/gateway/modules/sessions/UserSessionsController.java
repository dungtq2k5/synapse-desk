package com.synapsedesk.gateway.modules.sessions;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.SessionResponseDto;
import com.synapsedesk.gateway.modules.sessions.dto.rest.RevokedCountDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Session.ListUserSessionsRequest;
import synapsedesk.auth.Session.RevokeUserSessionsRequest;
import synapsedesk.auth.Session.RevokeUserSessionsResponse;
import synapsedesk.auth.Session.SessionResponse;
import synapsedesk.auth.SessionServiceGrpc;

/**
 * `UserSessionsApi` — the admin view of ANOTHER user's sessions, against
 * auth-service's `SessionService`. Same channel as `UsersApi`/`OtpApi`:
 * auth-service is already paid for, so no new bean here.
 *
 * <p>`revoke`'s {@code data} is the {@code {revokedCount}} shape
 * {@link RevokedCountDto} names.
 */
@Tag(name = "User Sessions")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class UserSessionsController {

  private static final long DEADLINE_SECONDS = 5;

  private final SessionServiceGrpc.SessionServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public UserSessionsController(
    SessionServiceGrpc.SessionServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private SessionServiceGrpc.SessionServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  @GetMapping(
    value = "/users/{userId}/sessions",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_SESSION_READ)
  public ResponseEntity<
    ApiResponse<java.util.List<SessionResponseDto>>
  > userSessionsControllerListV1(@PathVariable("userId") String userId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response = withMetadata(context).listUserSessions(
      ListUserSessionsRequest.newBuilder().setUserId(userId).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        response
          .getItemsList()
          .stream()
          .map(UserSessionsController::toDto)
          .toList()
      )
    );
  }

  @DeleteMapping(
    value = "/users/{userId}/sessions",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.USER_SESSION_REVOKE)
  public ResponseEntity<
    ApiResponse<RevokedCountDto>
  > userSessionsControllerRevokeV1(@PathVariable("userId") String userId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeUserSessionsResponse response = withMetadata(
      context
    ).revokeUserSessions(
      RevokeUserSessionsRequest.newBuilder().setUserId(userId).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Sessions revoked",
        new RevokedCountDto(response.getRevokedCount())
      )
    );
  }

  private static SessionResponseDto toDto(SessionResponse session) {
    return new SessionResponseDto(
      session.getId(),
      session.hasDeviceName() ? session.getDeviceName() : null,
      session.getIpAddress(),
      session.getUserAgent(),
      session.getCurrent(),
      session.getIsTrusted(),
      session.hasTrustedUntil()
        ? toOffsetDateTime(session.getTrustedUntil())
        : null,
      toOffsetDateTime(session.getExpiresAt()),
      toOffsetDateTime(session.getCreatedAt())
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

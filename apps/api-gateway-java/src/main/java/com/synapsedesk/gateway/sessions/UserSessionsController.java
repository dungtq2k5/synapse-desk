package com.synapsedesk.gateway.sessions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.UserSessionsApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.SessionResponseDto;
import com.synapsedesk.gateway.generated.model.SessionsControllerListV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.security.RequirePermission;

import io.grpc.stub.MetadataUtils;
import synapsedesk.auth.SessionServiceGrpc;
import synapsedesk.auth.Session.ListUserSessionsRequest;
import synapsedesk.auth.Session.RevokeUserSessionsRequest;
import synapsedesk.auth.Session.RevokeUserSessionsResponse;
import synapsedesk.auth.Session.SessionResponse;

/**
 * `UserSessionsApi` — the admin view of ANOTHER user's sessions, against
 * auth-service's `SessionService`. Same channel as `UsersApi`/`OtpApi`:
 * auth-service is already paid for, so no new bean here.
 *
 * <p>`revoke`'s generated response type ({@code AuthControllerForgotPasswordV1202Response})
 * is reused structurally, not semantically — Node's own {@code @ApiWrappedResponse()}
 * declares no model for this route, so the generator gave it whatever
 * identically-shaped envelope it had already generated elsewhere. The real
 * Node handler still returns {@code {revokedCount}} inside `data`
 * (`TransformInterceptor` wraps whatever the handler returns, regardless of
 * what the decorator declared), so this mirrors that rather than the
 * generated type's name.
 */
@RestController
public class UserSessionsController implements UserSessionsApi {

  private static final long DEADLINE_SECONDS = 5;

  private final SessionServiceGrpc.SessionServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public UserSessionsController(
      SessionServiceGrpc.SessionServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private SessionServiceGrpc.SessionServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_SESSION_READ)
  public ResponseEntity<SessionsControllerListV1200Response> userSessionsControllerListV1(String userId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    var response =
        withMetadata(context)
            .listUserSessions(ListUserSessionsRequest.newBuilder().setUserId(userId).build());

    return ResponseEntity.ok(
        new SessionsControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(response.getItemsList().stream().map(UserSessionsController::toDto).toList()));
  }

  @Override
  @RequirePermission(PermissionCodesEnum.USER_SESSION_REVOKE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> userSessionsControllerRevokeV1(
      String userId) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeUserSessionsResponse response =
        withMetadata(context)
            .revokeUserSessions(RevokeUserSessionsRequest.newBuilder().setUserId(userId).build());

    return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Sessions revoked")
            .data(Map.of("revokedCount", BigDecimal.valueOf(response.getRevokedCount()))));
  }

  private static SessionResponseDto toDto(SessionResponse session) {
    return new SessionResponseDto(
        session.getId(),
        session.hasDeviceName() ? session.getDeviceName() : null,
        session.getIpAddress(),
        session.getUserAgent(),
        session.getCurrent(),
        session.getIsTrusted(),
        session.hasTrustedUntil() ? toOffsetDateTime(session.getTrustedUntil()) : null,
        toOffsetDateTime(session.getExpiresAt()),
        toOffsetDateTime(session.getCreatedAt()));
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}

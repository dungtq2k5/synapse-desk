package com.synapsedesk.gateway.sessions;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.SessionsApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.RevokeTrustResponseDto;
import com.synapsedesk.gateway.generated.model.SessionResponseDto;
import com.synapsedesk.gateway.generated.model.SessionsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.SessionsControllerRevokeAllTrustV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.auth.Session.RevokeAllTrustRequest;
import synapsedesk.auth.Session.RevokeSessionResponse;
import synapsedesk.auth.Session.RevokeTrustResponse;
import synapsedesk.auth.Session.SessionIdRequest;
import synapsedesk.auth.Session.SessionResponse;
import synapsedesk.auth.SessionServiceGrpc;

/**
 * `SessionsApi` — the caller's OWN device sessions, against auth-service's
 * `SessionService`. Every route needs no {@code @RequirePermission} at all:
 * ownership of the session IS the authorization, the same as {@code
 * UserSessionsController} is the admin half that DOES need
 * `user.session.read`/`user.session.revoke`.
 *
 * <p>
 * The refresh token is read from the COOKIE, never a body or query, and used
 * ONLY to identify which session is {@code current} — a caller whose refresh
 * cookie has already been cleared still sees their list, just with nothing
 * marked current.
 *
 * <p>
 * <b>{@code revoke} clears cookies when the revoked family was the caller's
 * own</b> ({@code was_current}, reported by auth-service — the gateway never
 * sees a family id and cannot work this out itself), so "sign out this
 * device" pressed on that device behaves like a logout: both session cookies
 * and the device-token cookie, matching {@code JwtCookieService
 * .clearSessionCookies}/{@code .clearDeviceTokenCookie} exactly via the
 * existing {@link CookieWriter}.
 */
@RestController
public class SessionsController implements SessionsApi {

  private static final long DEADLINE_SECONDS = 5;

  private final SessionServiceGrpc.SessionServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CookieWriter cookies;

  public SessionsController(
      SessionServiceGrpc.SessionServiceBlockingStub stub, CurrentUser currentUser, CookieWriter cookies) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cookies = cookies;
  }

  @Override
  public ResponseEntity<SessionsControllerListV1200Response> sessionsControllerListV1() {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    synapsedesk.auth.Session.ListSessionsRequest.Builder wire =
        synapsedesk.auth.Session.ListSessionsRequest.newBuilder();
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    var response = withMetadata(context).listSessions(wire.build());

    return ResponseEntity.ok(
        new SessionsControllerListV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(response.getItemsList().stream().map(SessionsController::toDto).toList()));
  }

  @Override
  public ResponseEntity<SessionsControllerRevokeAllTrustV1200Response> sessionsControllerRevokeAllTrustV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeTrustResponse response = withMetadata(context).revokeAllTrust(RevokeAllTrustRequest.getDefaultInstance());

    return ResponseEntity.ok(
        new SessionsControllerRevokeAllTrustV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Trusted devices cleared")
            .data(new RevokeTrustResponseDto(BigDecimal.valueOf(response.getUntrustedCount()))));
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> sessionsControllerRevokeV1(String id) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    SessionIdRequest.Builder wire = SessionIdRequest.newBuilder().setSessionId(id);
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    RevokeSessionResponse response = withMetadata(context).revokeSession(wire.build());

    if (response.getWasCurrent()) {
      cookies.clearSession(CurrentRequest.response());
      cookies.clearDeviceToken(CurrentRequest.response());
    }

    return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Session revoked")
            .data(Map.of("revokedCount", BigDecimal.valueOf(response.getRevokedCount()))));
  }

  @Override
  public ResponseEntity<SessionsControllerRevokeAllTrustV1200Response> sessionsControllerRevokeTrustV1(String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeTrustResponse response =
        withMetadata(context).revokeSessionTrust(SessionIdRequest.newBuilder().setSessionId(id).build());

    return ResponseEntity.ok(
        new SessionsControllerRevokeAllTrustV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Device trust removed")
            .data(new RevokeTrustResponseDto(BigDecimal.valueOf(response.getUntrustedCount()))));
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

  private SessionServiceGrpc.SessionServiceBlockingStub withMetadata(RequestContext context) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }
}

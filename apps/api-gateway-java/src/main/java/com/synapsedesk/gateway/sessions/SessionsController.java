package com.synapsedesk.gateway.sessions;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.RevokeTrustResponseDto;
import com.synapsedesk.gateway.generated.model.SessionResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
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
 *
 * <p><b>Migrated off `SessionsApi`.</b> `revoke`'s {@code data} is the same
 * ad-hoc {@code {revokedCount}} shape `UserSessionsController`'s admin-side
 * revoke carries — {@code ApiResponse<Object>} names that honestly rather
 * than reusing another route's generated class.
 */
@Tag(name = "Sessions")
@RestController
@RequestMapping(ApiPaths.V1)
// Sign-in and session routes are never gated: a member of a frozen workspace must still be able to sign in and be told why.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
public class SessionsController {

  private static final long DEADLINE_SECONDS = 5;

  private final SessionServiceGrpc.SessionServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CookieWriter cookies;

  public SessionsController(
    SessionServiceGrpc.SessionServiceBlockingStub stub,
    CurrentUser currentUser,
    CookieWriter cookies
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cookies = cookies;
  }

  @GetMapping(value = "/auth/sessions", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<List<SessionResponseDto>>
  > sessionsControllerListV1() {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    synapsedesk.auth.Session.ListSessionsRequest.Builder wire =
      synapsedesk.auth.Session.ListSessionsRequest.newBuilder();
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    var response = withMetadata(context).listSessions(wire.build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        response.getItemsList().stream().map(SessionsController::toDto).toList()
      )
    );
  }

  @DeleteMapping(
    value = "/auth/sessions/trusted",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<RevokeTrustResponseDto>
  > sessionsControllerRevokeAllTrustV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeTrustResponse response = withMetadata(context).revokeAllTrust(
      RevokeAllTrustRequest.getDefaultInstance()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Trusted devices cleared",
        new RevokeTrustResponseDto(
          java.math.BigDecimal.valueOf(response.getUntrustedCount())
        )
      )
    );
  }

  @DeleteMapping(
    value = "/auth/sessions/{id}/trust",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<RevokeTrustResponseDto>
  > sessionsControllerRevokeTrustV1(@PathVariable("id") String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RevokeTrustResponse response = withMetadata(context).revokeSessionTrust(
      SessionIdRequest.newBuilder().setSessionId(id).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Device trust removed",
        new RevokeTrustResponseDto(
          java.math.BigDecimal.valueOf(response.getUntrustedCount())
        )
      )
    );
  }

  @DeleteMapping(
    value = "/auth/sessions/{id}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<RevokedCountDto>
  > sessionsControllerRevokeV1(@PathVariable("id") String id) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    SessionIdRequest.Builder wire = SessionIdRequest.newBuilder().setSessionId(
      id
    );
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    RevokeSessionResponse response = withMetadata(context).revokeSession(
      wire.build()
    );

    if (response.getWasCurrent()) {
      cookies.clearSession(CurrentRequest.response());
      cookies.clearDeviceToken(CurrentRequest.response());
    }

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Session revoked",
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

  private SessionServiceGrpc.SessionServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}

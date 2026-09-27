package com.synapsedesk.gateway.twofactor;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.JwtPrincipal;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.generated.api.TwoFactorAuthApi;
import com.synapsedesk.gateway.generated.model.ActivateTwoFactorDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.AuthenticateTwoFactorDto;
import com.synapsedesk.gateway.generated.model.BackupCodesResponseDto;
import com.synapsedesk.gateway.generated.model.BackupCodesStatusResponseDto;
import com.synapsedesk.gateway.generated.model.DisableTwoFactorDto;
import com.synapsedesk.gateway.generated.model.GenerateTwoFactorResponseDto;
import com.synapsedesk.gateway.generated.model.RegenerateBackupCodesDto;
import com.synapsedesk.gateway.generated.model.TwoFactorAuthControllerActivateV1200Response;
import com.synapsedesk.gateway.generated.model.TwoFactorAuthControllerAuthenticateV1200Response;
import com.synapsedesk.gateway.generated.model.TwoFactorAuthControllerGenerateV1200Response;
import com.synapsedesk.gateway.generated.model.TwoFactorAuthControllerGetBackupCodesStatusV1200Response;
import com.synapsedesk.gateway.generated.model.TwoFactorAuthenticatedResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.throttle.AuthThrottle;
import com.synapsedesk.gateway.throttle.RouteThrottle;
import io.grpc.stub.MetadataUtils;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.UserResponse;
import synapsedesk.auth.TwoFactor.ActivateTwoFactorRequest;
import synapsedesk.auth.TwoFactor.ActivateTwoFactorResponse;
import synapsedesk.auth.TwoFactor.AuthenticateTwoFactorRequest;
import synapsedesk.auth.TwoFactor.AuthenticateTwoFactorResponse;
import synapsedesk.auth.TwoFactor.BackupCodesStatusRequest;
import synapsedesk.auth.TwoFactor.BackupCodesStatusResponse;
import synapsedesk.auth.TwoFactor.DisableTwoFactorRequest;
import synapsedesk.auth.TwoFactor.GenerateTwoFactorRequest;
import synapsedesk.auth.TwoFactor.GenerateTwoFactorResponse;
import synapsedesk.auth.TwoFactor.RegenerateBackupCodesRequest;
import synapsedesk.auth.TwoFactor.RegenerateBackupCodesResponse;
import synapsedesk.auth.TwoFactorAuthServiceGrpc;

/**
 * `TwoFactorAuthApi` — enrolment and recovery, against auth-service's
 * `TwoFactorAuthService`. Every route except {@code authenticate} requires a
 * full session; `authenticate` is the exception because it is the second half
 * of a login that has not completed yet, authorized by the short-lived 2FA
 * cookie instead.
 *
 * <p>
 * <b>{@code generate}/{@code activate} admit EITHER identity.</b> A tenant
 * that just turned on {@code enforce_two_factor} leaves a not-yet-enrolled
 * member holding only a challenge token — with no fallback, that member could
 * never reach {@code /setup} (needs an access token) or {@code /authenticate}
 * (needs an already-configured secret), a dead end with no in-product way
 * out. Both enrolment RPCs refuse an account whose 2FA is already enabled, so
 * admitting the challenge token here is safe: the only reachable case is an
 * account with no second factor yet, where the password already proven by the
 * challenge is the whole credential. The full session is tried FIRST, so an
 * ordinary voluntary enrolment keeps its own error shape.
 *
 * <p>
 * <b>{@code authenticate} accepts ONLY the 2FA cookie — never falls back to
 * an access token.</b> The RAW TOKEN is forwarded, not a claim read off it:
 * auth-service re-verifies it as the authority, because a caller-supplied id
 * with no proof would make the gateway the only checkpoint rather than the
 * first one. The gateway's own verification here is a fast 401 at the edge,
 * nothing more.
 */
@RestController
@AuthThrottle
public class TwoFactorAuthController implements TwoFactorAuthApi {

  private static final long DEADLINE_SECONDS = 5;
  private static final String ENROLMENT_REFUSED =
      "Enrolling in two-factor authentication requires a valid session or a live login challenge";

  private final TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final com.synapsedesk.gateway.auth.JwtVerifier verifier;
  private final CookieWriter cookies;

  public TwoFactorAuthController(
      TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub stub,
      CurrentUser currentUser,
      com.synapsedesk.gateway.auth.JwtVerifier verifier,
      CookieWriter cookies) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.verifier = verifier;
    this.cookies = cookies;
  }

  @Override
  public ResponseEntity<TwoFactorAuthControllerGenerateV1200Response> twoFactorAuthControllerGenerateV1() {
    HttpServletRequest request = CurrentRequest.request();
    Enrollee enrollee = requireEnrollee(request);

    GenerateTwoFactorResponse response =
        withMetadata(enrollee.origin())
            .generateTwoFactor(GenerateTwoFactorRequest.newBuilder().setUserId(enrollee.sub()).build());

    return ResponseEntity.ok(
        new TwoFactorAuthControllerGenerateV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new GenerateTwoFactorResponseDto(response.getOtpauthUri(), response.getQrCodeDataUrl())));
  }

  @Override
  public ResponseEntity<TwoFactorAuthControllerActivateV1200Response> twoFactorAuthControllerActivateV1(
      ActivateTwoFactorDto activateTwoFactorDto) {
    HttpServletRequest request = CurrentRequest.request();
    Enrollee enrollee = requireEnrollee(request);

    ActivateTwoFactorResponse response =
        withMetadata(enrollee.origin())
            .activateTwoFactor(
                ActivateTwoFactorRequest.newBuilder()
                    .setUserId(enrollee.sub())
                    .setCode(activateTwoFactorDto.getCode())
                    .build());

    return ResponseEntity.ok(
        new TwoFactorAuthControllerActivateV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new BackupCodesResponseDto(response.getBackupCodesList())));
  }

  @Override
  @AuthThrottle(
      ttlMs = RouteThrottle.TWO_FACTOR_AUTHENTICATE_TTL_MS,
      limit = RouteThrottle.TWO_FACTOR_AUTHENTICATE_LIMIT)
  public ResponseEntity<TwoFactorAuthControllerAuthenticateV1200Response> twoFactorAuthControllerAuthenticateV1(
      AuthenticateTwoFactorDto authenticateTwoFactorDto) {
    HttpServletRequest request = CurrentRequest.request();
    String twoFactorToken = requireTwoFactorToken(request);
    RequestOrigin origin = currentUser.origin(request);

    AuthenticateTwoFactorRequest.Builder wire =
        AuthenticateTwoFactorRequest.newBuilder()
            .setTwoFactorToken(twoFactorToken)
            .setRememberDevice(Boolean.TRUE.equals(authenticateTwoFactorDto.getRememberDevice()));
    if (authenticateTwoFactorDto.getCode() != null) {
      wire.setCode(authenticateTwoFactorDto.getCode());
    }
    if (authenticateTwoFactorDto.getBackupCode() != null) {
      wire.setBackupCode(authenticateTwoFactorDto.getBackupCode());
    }
    if (authenticateTwoFactorDto.getDeviceName() != null) {
      wire.setDeviceName(authenticateTwoFactorDto.getDeviceName());
    }

    AuthenticateTwoFactorResponse response = withMetadata(origin).authenticateTwoFactor(wire.build());

    // The challenge is spent before the real session is set, so a failure
    // between the two cannot leave a reusable challenge behind.
    cookies.clearTwoFactorToken(CurrentRequest.response());
    cookies.setAccessToken(CurrentRequest.response(), response.getAccessToken());
    cookies.setRefreshToken(CurrentRequest.response(), response.getRefreshToken());
    if (response.hasDeviceToken()) {
      cookies.setDeviceToken(CurrentRequest.response(), response.getDeviceToken());
    }

    UserResponse user = response.getUser();
    return ResponseEntity.ok(
        new TwoFactorAuthControllerAuthenticateV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new TwoFactorAuthenticatedResponseDto(
                    UserMapper.toUserResponseDto(user), response.hasWarning() ? response.getWarning() : null)));
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> twoFactorAuthControllerDisableV1(
      DisableTwoFactorDto disableTwoFactorDto) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    withMetadata(context.origin())
        .disableTwoFactor(
            DisableTwoFactorRequest.newBuilder()
                .setUserId(context.sub())
                .setCode(disableTwoFactorDto.getCode())
                .setPassword(disableTwoFactorDto.getPassword())
                .build());

    // auth-service just un-trusted every device; drop the now-meaningless cookie.
    cookies.clearDeviceToken(CurrentRequest.response());

    return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(null));
  }

  @Override
  public ResponseEntity<TwoFactorAuthControllerActivateV1200Response> twoFactorAuthControllerRegenerateBackupCodesV1(
      RegenerateBackupCodesDto regenerateBackupCodesDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RegenerateBackupCodesResponse response =
        withMetadata(context.origin())
            .regenerateBackupCodes(
                RegenerateBackupCodesRequest.newBuilder()
                    .setUserId(context.sub())
                    .setPassword(regenerateBackupCodesDto.getPassword())
                    .build());

    return ResponseEntity.ok(
        new TwoFactorAuthControllerActivateV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(new BackupCodesResponseDto(response.getBackupCodesList())));
  }

  @Override
  public ResponseEntity<TwoFactorAuthControllerGetBackupCodesStatusV1200Response>
      twoFactorAuthControllerGetBackupCodesStatusV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    BackupCodesStatusResponse response =
        withMetadata(context.origin())
            .getBackupCodesStatus(BackupCodesStatusRequest.newBuilder().setUserId(context.sub()).build());

    return ResponseEntity.ok(
        new TwoFactorAuthControllerGetBackupCodesStatusV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new BackupCodesStatusResponseDto(
                    BigDecimal.valueOf(response.getRemaining()),
                    BigDecimal.valueOf(response.getUsed()),
                    response.hasExpiresAt() ? toOffsetDateTime(response.getExpiresAt()) : null)));
  }

  /** `EnrolleeContext` — only what a full session and a mid-challenge caller share. */
  private record Enrollee(String sub, RequestOrigin origin) {}

  /**
   * `TwoFactorEnrolmentGuard`, reproduced: a full session first, then a
   * verified 2FA-challenge cookie, and a 401 naming both doors if neither
   * holds. No guard/interceptor layer exists here, so this is a handler-body
   * check — the same shape as {@code GuestCheck} and {@code
   * requireEmailVerified}.
   */
  private Enrollee requireEnrollee(HttpServletRequest request) {
    Optional<RequestContext> full = currentUser.read(request);
    if (full.isPresent()) {
      return new Enrollee(full.get().sub(), full.get().origin());
    }

    Optional<JwtPrincipal> challenge = cookies.readTwoFactorToken(request).flatMap(verifier::verifyTwoFactor);
    if (challenge.isPresent()) {
      return new Enrollee(challenge.get().sub(), currentUser.origin(request));
    }

    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, ENROLMENT_REFUSED);
  }

  /**
   * `Jwt2faGuard`, reproduced: the 2FA cookie ONLY, verified cryptographically
   * before the peer is ever dialed — never a fallback to an access token. The
   * RAW token is returned, not a claim off it, since auth-service is the
   * authority that re-verifies it.
   */
  private String requireTwoFactorToken(HttpServletRequest request) {
    String token = cookies.readTwoFactorToken(request).orElseThrow(TwoFactorAuthController::unauthorized);
    if (verifier.verifyTwoFactor(token).isEmpty()) {
      throw unauthorized();
    }
    return token;
  }

  private static ResponseStatusException unauthorized() {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }

  private TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub withMetadata(RequestOrigin origin) {
    return stub
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(origin)));
  }
}

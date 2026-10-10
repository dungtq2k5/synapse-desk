package com.synapsedesk.gateway.twofactor;

import com.synapsedesk.gateway.auth.CookieWriter;
import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.auth.UserMapper;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.model.ActivateTwoFactorDto;
import com.synapsedesk.gateway.model.AuthenticateTwoFactorDto;
import com.synapsedesk.gateway.model.BackupCodesResponseDto;
import com.synapsedesk.gateway.model.BackupCodesStatusResponseDto;
import com.synapsedesk.gateway.model.DisableTwoFactorDto;
import com.synapsedesk.gateway.model.GenerateTwoFactorResponseDto;
import com.synapsedesk.gateway.model.RegenerateBackupCodesDto;
import com.synapsedesk.gateway.model.TwoFactorAuthenticatedResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.openapi.RouteSecurity;
import com.synapsedesk.gateway.openapi.RouteSecurity;
import com.synapsedesk.gateway.security.TwoFactorEnrolmentGuard;
import com.synapsedesk.gateway.security.TwoFactorEnrolmentGuard.Enrollee;
import com.synapsedesk.gateway.throttle.AuthThrottle;
import com.synapsedesk.gateway.throttle.RouteThrottle;
import com.synapsedesk.gateway.throttle.ThrottleOverride;
import com.synapsedesk.gateway.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
 *
 * <p><b>Migrated off `TwoFactorAuthApi`.</b> `activate` and
 * `regenerateBackupCodes` shared ONE generated response class for two
 * different routes — the dedup this flip retires — and now each returns
 * {@code ApiResponse<BackupCodesResponseDto>} on its own.
 */
@Tag(name = "Two Factor Auth")
@RestController
@RequestMapping(ApiPaths.V1)
// Sign-in and session routes are never gated: a member of a frozen workspace must still be able to sign in and be told why.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
@AuthThrottle
public class TwoFactorAuthController {

  private static final long DEADLINE_SECONDS = 5;

  private final TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final com.synapsedesk.gateway.auth.JwtVerifier verifier;
  private final CookieWriter cookies;
  private final TwoFactorEnrolmentGuard enrolment;

  public TwoFactorAuthController(
    TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub stub,
    CurrentUser currentUser,
    com.synapsedesk.gateway.auth.JwtVerifier verifier,
    CookieWriter cookies,
    TwoFactorEnrolmentGuard enrolment
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.verifier = verifier;
    this.cookies = cookies;
    this.enrolment = enrolment;
  }

  @RouteSecurity(RouteSecurity.Scheme.SESSION_OR_CHALLENGE)
  @PostMapping(value = "/auth/2fa/setup", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<GenerateTwoFactorResponseDto>
  > twoFactorAuthControllerGenerateV1() {
    HttpServletRequest request = CurrentRequest.request();
    Enrollee enrollee = enrolment.require(request);

    GenerateTwoFactorResponse response = withMetadata(
      enrollee.origin()
    ).generateTwoFactor(
      GenerateTwoFactorRequest.newBuilder().setUserId(enrollee.sub()).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new GenerateTwoFactorResponseDto(
          response.getOtpauthUri(),
          response.getQrCodeDataUrl()
        )
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.SESSION_OR_CHALLENGE)
  @PostMapping(
    value = "/auth/2fa/enable",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<BackupCodesResponseDto>
  > twoFactorAuthControllerActivateV1(
    @Valid @RequestBody ActivateTwoFactorDto activateTwoFactorDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    Enrollee enrollee = enrolment.require(request);

    ActivateTwoFactorResponse response = withMetadata(
      enrollee.origin()
    ).activateTwoFactor(
      ActivateTwoFactorRequest.newBuilder()
        .setUserId(enrollee.sub())
        .setCode(activateTwoFactorDto.getCode())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new BackupCodesResponseDto(response.getBackupCodesList())
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.MFA_COOKIE)
  @PostMapping(
    value = "/auth/2fa/authenticate",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.TWO_FACTOR_AUTHENTICATE_TTL_MS,
    limit = RouteThrottle.TWO_FACTOR_AUTHENTICATE_LIMIT
  )
  public ResponseEntity<
    ApiResponse<TwoFactorAuthenticatedResponseDto>
  > twoFactorAuthControllerAuthenticateV1(
    @Valid @RequestBody AuthenticateTwoFactorDto authenticateTwoFactorDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    String twoFactorToken = requireTwoFactorToken(request);
    RequestOrigin origin = currentUser.origin(request);

    AuthenticateTwoFactorRequest.Builder wire =
      AuthenticateTwoFactorRequest.newBuilder()
        .setTwoFactorToken(twoFactorToken)
        .setRememberDevice(
          Boolean.TRUE.equals(authenticateTwoFactorDto.getRememberDevice())
        );
    if (authenticateTwoFactorDto.getCode() != null) {
      wire.setCode(authenticateTwoFactorDto.getCode());
    }
    if (authenticateTwoFactorDto.getBackupCode() != null) {
      wire.setBackupCode(authenticateTwoFactorDto.getBackupCode());
    }
    if (authenticateTwoFactorDto.getDeviceName() != null) {
      wire.setDeviceName(authenticateTwoFactorDto.getDeviceName());
    }

    AuthenticateTwoFactorResponse response = withMetadata(
      origin
    ).authenticateTwoFactor(wire.build());

    // The challenge is spent before the real session is set, so a failure
    // between the two cannot leave a reusable challenge behind.
    cookies.clearTwoFactorToken(CurrentRequest.response());
    cookies.setAccessToken(
      CurrentRequest.response(),
      response.getAccessToken()
    );
    cookies.setRefreshToken(
      CurrentRequest.response(),
      response.getRefreshToken()
    );
    if (response.hasDeviceToken()) {
      cookies.setDeviceToken(
        CurrentRequest.response(),
        response.getDeviceToken()
      );
    }

    UserResponse user = response.getUser();
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new TwoFactorAuthenticatedResponseDto(
          UserMapper.toUserResponseDto(user),
          response.hasWarning() ? response.getWarning() : null
        )
      )
    );
  }

  @DeleteMapping(
    value = "/auth/2fa",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<ApiResponse<Void>> twoFactorAuthControllerDisableV1(
    @Valid @RequestBody DisableTwoFactorDto disableTwoFactorDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    withMetadata(context.origin()).disableTwoFactor(
      DisableTwoFactorRequest.newBuilder()
        .setUserId(context.sub())
        .setCode(disableTwoFactorDto.getCode())
        .setPassword(disableTwoFactorDto.getPassword())
        .build()
    );

    // auth-service just un-trusted every device; drop the now-meaningless cookie.
    cookies.clearDeviceToken(CurrentRequest.response());

    return ResponseEntity.ok(ApiResponse.of(200, "OK", null));
  }

  @PostMapping(
    value = "/auth/2fa/backup-codes",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<BackupCodesResponseDto>
  > twoFactorAuthControllerRegenerateBackupCodesV1(
    @Valid @RequestBody RegenerateBackupCodesDto regenerateBackupCodesDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RegenerateBackupCodesResponse response = withMetadata(
      context.origin()
    ).regenerateBackupCodes(
      RegenerateBackupCodesRequest.newBuilder()
        .setUserId(context.sub())
        .setPassword(regenerateBackupCodesDto.getPassword())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new BackupCodesResponseDto(response.getBackupCodesList())
      )
    );
  }

  @GetMapping(
    value = "/auth/2fa/backup-codes",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<BackupCodesStatusResponseDto>
  > twoFactorAuthControllerGetBackupCodesStatusV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    BackupCodesStatusResponse response = withMetadata(
      context.origin()
    ).getBackupCodesStatus(
      BackupCodesStatusRequest.newBuilder().setUserId(context.sub()).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new BackupCodesStatusResponseDto(
          BigDecimal.valueOf(response.getRemaining()),
          BigDecimal.valueOf(response.getUsed()),
          response.hasExpiresAt()
            ? toOffsetDateTime(response.getExpiresAt())
            : null
        )
      )
    );
  }

  /**
   * `Jwt2faGuard`, reproduced: the 2FA cookie ONLY, verified cryptographically
   * before the peer is ever dialed — never a fallback to an access token. The
   * RAW token is returned, not a claim off it, since auth-service is the
   * authority that re-verifies it.
   */
  private String requireTwoFactorToken(HttpServletRequest request) {
    String token = cookies
      .readTwoFactorToken(request)
      .orElseThrow(TwoFactorAuthController::unauthorized);
    if (verifier.verifyTwoFactor(token).isEmpty()) {
      throw unauthorized();
    }
    return token;
  }

  private static ResponseStatusException unauthorized() {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  private TwoFactorAuthServiceGrpc.TwoFactorAuthServiceBlockingStub withMetadata(
    RequestOrigin origin
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(origin))
      );
  }
}

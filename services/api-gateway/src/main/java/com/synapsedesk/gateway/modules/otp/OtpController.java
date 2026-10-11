package com.synapsedesk.gateway.modules.otp;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.throttle.AuthThrottle;
import com.synapsedesk.gateway.common.throttle.RouteThrottle;
import com.synapsedesk.gateway.common.throttle.ThrottleOverride;
import com.synapsedesk.gateway.common.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.model.OtpStatusResponseDto;
import com.synapsedesk.gateway.model.RequestOtpResponseDto;
import com.synapsedesk.gateway.model.RequestPhoneVerificationDto;
import com.synapsedesk.gateway.model.VerifyOtpDto;
import com.synapsedesk.gateway.model.VerifyOtpResponseDto;
import com.synapsedesk.gateway.modules.otp.dto.rest.OtpPurposeFilter;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Otp.OtpPurpose;
import synapsedesk.auth.Otp.OtpStatusRequest;
import synapsedesk.auth.Otp.OtpStatusResponse;
import synapsedesk.auth.Otp.RequestEmailVerificationRequest;
import synapsedesk.auth.Otp.RequestOtpResponse;
import synapsedesk.auth.Otp.RequestPhoneVerificationRequest;
import synapsedesk.auth.Otp.VerifyOtpRequest;
import synapsedesk.auth.Otp.VerifyOtpResponse;
import synapsedesk.auth.OtpServiceGrpc;

/**
 * `OtpApi`, against `auth-service`'s `OtpService` — the existing auth channel,
 * no new peer.
 *
 * <p><b>No guard here is deliberate, not missing.</b> `GuestGuard` would
 * reject every caller (all five routes need a session); `EmailVerifiedGuard`
 * would deadlock the account, since these ARE the routes that make a user
 * verified. Only {@link CurrentUser#require} runs — the same one full-session
 * check every other authenticated route makes.
 *
 * <p>All five routes see {@code authTier} only ({@link AuthThrottle} at class
 * level); the two request routes and the two verify routes each carry their
 * own {@code otpRequest}/{@code otpVerify} numbers, and `getOtpStatus` falls
 * back to {@code authTier}'s configured default.
 *
 * <p><b>Migrated off `OtpApi`.</b> The two request routes answer 202, not
 * 200 — {@code @ResponseStatus} is what tells springdoc that.
 */
@Tag(name = "Otp")
@RestController
@RequestMapping(ApiPaths.V1)
// Sign-in and session routes are never gated: a member of a frozen workspace must still be able to sign in and be told why.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
@AuthThrottle
public class OtpController {

  private static final long DEADLINE_SECONDS = 5;

  private final OtpServiceGrpc.OtpServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public OtpController(
    OtpServiceGrpc.OtpServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private OtpServiceGrpc.OtpServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  @PostMapping(
    value = "/auth/email/verify/request",
    produces = { "application/json" }
  )
  @ApiErrors({ "401" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.OTP_REQUEST_TTL_MS,
    limit = RouteThrottle.OTP_REQUEST_LIMIT
  )
  public ResponseEntity<
    ApiResponse<RequestOtpResponseDto>
  > otpControllerRequestEmailVerificationV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RequestOtpResponse response = withMetadata(
      context
    ).requestEmailVerification(
      RequestEmailVerificationRequest.newBuilder()
        .setUserId(context.sub())
        .build()
    );

    return ResponseEntity.status(202).body(
      ApiResponse.of(202, "OK", toRequestOtpDto(response))
    );
  }

  @PostMapping(
    value = "/auth/email/verify",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.OTP_VERIFY_TTL_MS,
    limit = RouteThrottle.OTP_VERIFY_LIMIT
  )
  public ResponseEntity<
    ApiResponse<VerifyOtpResponseDto>
  > otpControllerVerifyEmailV1(@Valid @RequestBody VerifyOtpDto verifyOtpDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    VerifyOtpResponse response = withMetadata(context).verifyEmail(
      VerifyOtpRequest.newBuilder()
        .setUserId(context.sub())
        .setCode(verifyOtpDto.getCode())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toVerifyOtpDto(response))
    );
  }

  @PostMapping(
    value = "/auth/phone/verify/request",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.OTP_REQUEST_TTL_MS,
    limit = RouteThrottle.OTP_REQUEST_LIMIT
  )
  public ResponseEntity<
    ApiResponse<RequestOtpResponseDto>
  > otpControllerRequestPhoneVerificationV1(
    @Valid @RequestBody RequestPhoneVerificationDto requestPhoneVerificationDto
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RequestOtpResponse response = withMetadata(
      context
    ).requestPhoneVerification(
      RequestPhoneVerificationRequest.newBuilder()
        .setUserId(context.sub())
        .setPhoneNumber(requestPhoneVerificationDto.getPhoneNumber())
        .build()
    );

    return ResponseEntity.status(202).body(
      ApiResponse.of(202, "OK", toRequestOtpDto(response))
    );
  }

  @PostMapping(
    value = "/auth/phone/verify",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.OTP_VERIFY_TTL_MS,
    limit = RouteThrottle.OTP_VERIFY_LIMIT
  )
  public ResponseEntity<
    ApiResponse<VerifyOtpResponseDto>
  > otpControllerVerifyPhoneV1(@Valid @RequestBody VerifyOtpDto verifyOtpDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    VerifyOtpResponse response = withMetadata(context).verifyPhone(
      VerifyOtpRequest.newBuilder()
        .setUserId(context.sub())
        .setCode(verifyOtpDto.getCode())
        .build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", toVerifyOtpDto(response))
    );
  }

  @GetMapping(value = "/auth/otp/status", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<OtpStatusResponseDto>
  > otpControllerGetOtpStatusV1(
    @NotNull @Valid @RequestParam(
      value = "purpose",
      required = true
    ) OtpPurposeFilter purposeFilter
  ) {
    String purpose = purposeFilter.name();
    RequestContext context = currentUser.require(CurrentRequest.request());

    OtpStatusResponse response = withMetadata(context).getOtpStatus(
      OtpStatusRequest.newBuilder()
        .setUserId(context.sub())
        .setPurpose(toProtoPurpose(purpose))
        .build()
    );

    OtpStatusResponseDto data = new OtpStatusResponseDto()
      .pending(response.getPending())
      .target(response.hasTarget() ? response.getTarget() : null)
      .expiresAt(
        response.hasExpiresAt()
          ? toOffsetDateTime(response.getExpiresAt())
          : null
      )
      .attemptsRemaining(BigDecimal.valueOf(response.getAttemptsRemaining()));

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  /**
   * `EMAIL_VERIFICATION` / `PHONE_VERIFICATION` — the REST contract's readable
   * strings, matching `OTP_PURPOSES`. An unrecognized value is a 400, not a
   * silent `OTP_PURPOSE_UNSPECIFIED`: proto's own zero member exists so THAT
   * can never reach the service disguised as a real purpose.
   */
  private static OtpPurpose toProtoPurpose(String purpose) {
    return switch (purpose) {
      case "EMAIL_VERIFICATION" -> OtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION;
      case "PHONE_VERIFICATION" -> OtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION;
      default -> throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Invalid purpose: " + purpose
      );
    };
  }

  private static RequestOtpResponseDto toRequestOtpDto(
    RequestOtpResponse response
  ) {
    return new RequestOtpResponseDto()
      .target(response.getTarget())
      .expiresInMinutes(BigDecimal.valueOf(response.getExpiresInMinutes()));
  }

  private static VerifyOtpResponseDto toVerifyOtpDto(
    VerifyOtpResponse response
  ) {
    return new VerifyOtpResponseDto()
      .verified(response.getVerified())
      .attemptsRemaining(BigDecimal.valueOf(response.getAttemptsRemaining()))
      .mustRequestNewCode(response.getMustRequestNewCode());
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

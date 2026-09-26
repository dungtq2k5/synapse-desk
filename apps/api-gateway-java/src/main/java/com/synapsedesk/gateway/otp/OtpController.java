package com.synapsedesk.gateway.otp;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.OtpApi;
import com.synapsedesk.gateway.generated.model.OtpControllerGetOtpStatusV1200Response;
import com.synapsedesk.gateway.generated.model.OtpControllerRequestEmailVerificationV1202Response;
import com.synapsedesk.gateway.generated.model.OtpControllerVerifyEmailV1200Response;
import com.synapsedesk.gateway.generated.model.OtpStatusResponseDto;
import com.synapsedesk.gateway.generated.model.RequestOtpResponseDto;
import com.synapsedesk.gateway.generated.model.RequestPhoneVerificationDto;
import com.synapsedesk.gateway.generated.model.VerifyOtpDto;
import com.synapsedesk.gateway.generated.model.VerifyOtpResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
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
 * <p>Throttling is out of scope: the {@code otpRequest} / {@code otpVerify}
 * tier split has nothing to enforce it here yet.
 */
@RestController
public class OtpController implements OtpApi {

  private static final long DEADLINE_SECONDS = 5;

  private final OtpServiceGrpc.OtpServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public OtpController(OtpServiceGrpc.OtpServiceBlockingStub stub, CurrentUser currentUser) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  private OtpServiceGrpc.OtpServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<OtpControllerRequestEmailVerificationV1202Response> otpControllerRequestEmailVerificationV1() {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RequestOtpResponse response =
        withMetadata(context)
            .requestEmailVerification(
                RequestEmailVerificationRequest.newBuilder().setUserId(context.sub()).build());

    return ResponseEntity.status(202)
        .body(
            new OtpControllerRequestEmailVerificationV1202Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(202))
                .message("OK")
                .data(toRequestOtpDto(response)));
  }

  @Override
  public ResponseEntity<OtpControllerVerifyEmailV1200Response> otpControllerVerifyEmailV1(VerifyOtpDto verifyOtpDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    VerifyOtpResponse response =
        withMetadata(context)
            .verifyEmail(
                VerifyOtpRequest.newBuilder()
                    .setUserId(context.sub())
                    .setCode(verifyOtpDto.getCode())
                    .build());

    return ResponseEntity.ok(
        new OtpControllerVerifyEmailV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toVerifyOtpDto(response)));
  }

  @Override
  public ResponseEntity<OtpControllerRequestEmailVerificationV1202Response> otpControllerRequestPhoneVerificationV1(
      RequestPhoneVerificationDto requestPhoneVerificationDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    RequestOtpResponse response =
        withMetadata(context)
            .requestPhoneVerification(
                RequestPhoneVerificationRequest.newBuilder()
                    .setUserId(context.sub())
                    .setPhoneNumber(requestPhoneVerificationDto.getPhoneNumber())
                    .build());

    return ResponseEntity.status(202)
        .body(
            new OtpControllerRequestEmailVerificationV1202Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(202))
                .message("OK")
                .data(toRequestOtpDto(response)));
  }

  @Override
  public ResponseEntity<OtpControllerVerifyEmailV1200Response> otpControllerVerifyPhoneV1(VerifyOtpDto verifyOtpDto) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    VerifyOtpResponse response =
        withMetadata(context)
            .verifyPhone(
                VerifyOtpRequest.newBuilder()
                    .setUserId(context.sub())
                    .setCode(verifyOtpDto.getCode())
                    .build());

    return ResponseEntity.ok(
        new OtpControllerVerifyEmailV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(toVerifyOtpDto(response)));
  }

  @Override
  public ResponseEntity<OtpControllerGetOtpStatusV1200Response> otpControllerGetOtpStatusV1(String purpose) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    OtpStatusResponse response =
        withMetadata(context)
            .getOtpStatus(
                OtpStatusRequest.newBuilder()
                    .setUserId(context.sub())
                    .setPurpose(toProtoPurpose(purpose))
                    .build());

    OtpStatusResponseDto data =
        new OtpStatusResponseDto()
            .pending(response.getPending())
            .target(response.hasTarget() ? response.getTarget() : null)
            .expiresAt(response.hasExpiresAt() ? toOffsetDateTime(response.getExpiresAt()) : null)
            .attemptsRemaining(BigDecimal.valueOf(response.getAttemptsRemaining()));

    return ResponseEntity.ok(
        new OtpControllerGetOtpStatusV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
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
          org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid purpose: " + purpose);
    };
  }

  private static RequestOtpResponseDto toRequestOtpDto(RequestOtpResponse response) {
    return new RequestOtpResponseDto()
        .target(response.getTarget())
        .expiresInMinutes(BigDecimal.valueOf(response.getExpiresInMinutes()));
  }

  private static VerifyOtpResponseDto toVerifyOtpDto(VerifyOtpResponse response) {
    return new VerifyOtpResponseDto()
        .verified(response.getVerified())
        .attemptsRemaining(BigDecimal.valueOf(response.getAttemptsRemaining()))
        .mustRequestNewCode(response.getMustRequestNewCode());
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}

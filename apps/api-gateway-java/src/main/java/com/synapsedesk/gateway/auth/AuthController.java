package com.synapsedesk.gateway.auth;

import com.synapsedesk.gateway.generated.api.AuthApi;
import com.synapsedesk.gateway.generated.model.AuthControllerChangePasswordV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.AuthControllerLoginV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerLoginV1200ResponseData;
import com.synapsedesk.gateway.generated.model.AuthControllerLogoutAllV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerLogoutV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerRefreshV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerRegisterV1201Response;
import com.synapsedesk.gateway.generated.model.AuthControllerResetPasswordV1200Response;
import com.synapsedesk.gateway.generated.model.AuthControllerValidatePasswordResetTokenV1200Response;
import com.synapsedesk.gateway.generated.model.ChangePasswordDto;
import com.synapsedesk.gateway.generated.model.ChangePasswordResponseDto;
import com.synapsedesk.gateway.generated.model.ForgotPasswordDto;
import com.synapsedesk.gateway.generated.model.GoogleSignInDto;
import com.synapsedesk.gateway.generated.model.LoginDto;
import com.synapsedesk.gateway.generated.model.LoginResponseDto;
import com.synapsedesk.gateway.generated.model.LoginWithTenantDto;
import com.synapsedesk.gateway.generated.model.LogoutAllResponseDto;
import com.synapsedesk.gateway.generated.model.LogoutDto;
import com.synapsedesk.gateway.generated.model.LogoutResponseDto;
import com.synapsedesk.gateway.generated.model.RegisterDto;
import com.synapsedesk.gateway.generated.model.RegisterResponseDto;
import com.synapsedesk.gateway.generated.model.ResetPasswordDto;
import com.synapsedesk.gateway.generated.model.ResetPasswordResponseDto;
import com.synapsedesk.gateway.generated.model.TenantOptionResponseDto;
import com.synapsedesk.gateway.generated.model.TenantSelectionResponseDto;
import com.synapsedesk.gateway.generated.model.TwoFactorRequiredResponseDto;
import com.synapsedesk.gateway.generated.model.ValidatePasswordResetTokenResponseDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.AuthServiceGrpc;
import synapsedesk.auth.Auth.ChangePasswordRequest;
import synapsedesk.auth.Auth.ForgotPasswordRequest;
import synapsedesk.auth.Auth.GoogleSignInRequest;
import synapsedesk.auth.Auth.LoginRequest;
import synapsedesk.auth.Auth.LoginResponse;
import synapsedesk.auth.Auth.LoginWithTenantRequest;
import synapsedesk.auth.Auth.LogoutAllRequest;
import synapsedesk.auth.Auth.LogoutRequest;
import synapsedesk.auth.Auth.RefreshTokenRequest;
import synapsedesk.auth.Auth.RegisterRequest;
import synapsedesk.auth.Auth.ResetPasswordRequest;
import synapsedesk.auth.Auth.ValidatePasswordResetTokenRequest;
import synapsedesk.auth.Auth.ValidatePasswordResetTokenResponse;

/**
 * `AuthApi`, implemented against auth-service over gRPC — the Node
 * `AuthController` + `AuthService` + `AuthServiceGrpcClient`, collapsed into
 * one class because this gateway has no equivalent three-layer split yet and
 * a thin adapter does not need one invented for it.
 *
 * <p>Every method here is a straight forward: unpack the REST DTO into a
 * proto request, pack the caller's context onto the metadata (the SAME rule
 * `CallerMetadata` states), call auth-service, map the response back. A
 * peer's `StatusRuntimeException` is not caught here — it reaches
 * {@code GatewayExceptionHandler}, exactly as a peer failure does on every
 * other route.
 */
@RestController
public class AuthController implements AuthApi {

  private static final long DEADLINE_SECONDS = 5;

  private final AuthServiceGrpc.AuthServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CookieWriter cookies;
  private final GuestCheck guestCheck;

  public AuthController(
      AuthServiceGrpc.AuthServiceBlockingStub stub,
      CurrentUser currentUser,
      CookieWriter cookies,
      GuestCheck guestCheck) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cookies = cookies;
    this.guestCheck = guestCheck;
  }

  private AuthServiceGrpc.AuthServiceBlockingStub withMetadata(
      HttpServletRequest request) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
            io.grpc.stub.MetadataUtils.newAttachHeadersInterceptor(
                CallerMetadata.of(currentUser.origin(request))));
  }

  private AuthServiceGrpc.AuthServiceBlockingStub withMetadata(RequestContext context) {
    return stub.withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
            io.grpc.stub.MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context)));
  }

  @Override
  public ResponseEntity<AuthControllerRegisterV1201Response> authControllerRegisterV1(
      RegisterDto registerDto) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    RegisterRequest wire =
        RegisterRequest.newBuilder()
            .setEmail(registerDto.getEmail())
            .setPassword(registerDto.getPassword())
            .setFullName(registerDto.getFullName())
            .build();
    synapsedesk.auth.Auth.RegisterResponse response = withMetadata(request).register(wire);

    RegisterResponseDto data =
        new RegisterResponseDto()
            .userId(response.getUserId())
            .organizationId(response.getOrganizationId())
            .email(response.getEmail())
            .requiresEmailVerification(response.getRequiresEmailVerification());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new AuthControllerRegisterV1201Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(201))
                .message("Registered")
                .data(data));
  }

  @Override
  public ResponseEntity<AuthControllerLoginV1200Response> authControllerLoginV1(LoginDto loginDto) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    LoginRequest.Builder wire =
        LoginRequest.newBuilder().setEmail(loginDto.getEmail()).setPassword(loginDto.getPassword());
    if (loginDto.getDeviceName() != null) {
      wire.setDeviceName(loginDto.getDeviceName());
    }
    cookies.readDeviceToken(request).ifPresent(wire::setDeviceToken);

    LoginResponse response = withMetadata(request).login(wire.build());

    return ResponseEntity.ok(
        new AuthControllerLoginV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(settleLogin(response, CurrentRequest.response())));
  }

  @Override
  public ResponseEntity<AuthControllerLoginV1200Response> authControllerLoginWithTenantV1(
      LoginWithTenantDto loginWithTenantDto) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    guestCheck.requireNoActiveSession(request);

    String tenantSelectionToken =
        cookies
            .readTenantSelectionToken(request)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "No tenant selection is in progress. Start again from login."));

    LoginWithTenantRequest.Builder wire =
        LoginWithTenantRequest.newBuilder()
            .setTenantSelectionToken(tenantSelectionToken)
            .setOrganizationId(loginWithTenantDto.getOrganizationId().toString());
    if (loginWithTenantDto.getDeviceName() != null) {
      wire.setDeviceName(loginWithTenantDto.getDeviceName());
    }
    cookies.readDeviceToken(request).ifPresent(wire::setDeviceToken);

    LoginResponse response = withMetadata(request).loginWithTenant(wire.build());

    // Spent either way — the token named a set of accounts, and one has now
    // been chosen.
    cookies.clearTenantSelection(httpResponse);

    return ResponseEntity.ok(
        new AuthControllerLoginV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(settleLogin(response, httpResponse)));
  }

  @Override
  public ResponseEntity<AuthControllerLoginV1200Response> authControllerGoogleSignInV1(
      GoogleSignInDto googleSignInDto) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    GoogleSignInRequest.Builder wire =
        GoogleSignInRequest.newBuilder().setIdToken(googleSignInDto.getIdToken());
    if (googleSignInDto.getDeviceName() != null) {
      wire.setDeviceName(googleSignInDto.getDeviceName());
    }
    cookies.readDeviceToken(request).ifPresent(wire::setDeviceToken);

    LoginResponse response = withMetadata(request).googleSignIn(wire.build());

    return ResponseEntity.ok(
        new AuthControllerLoginV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(settleLogin(response, CurrentRequest.response())));
  }

  /**
   * The proto's three-way union turned into cookies + a response body —
   * `settleLogin` / `toLoginResult`, reproduced. Tenant selection is checked
   * BEFORE 2FA: 2FA policy is per-tenant, unanswerable until the tenant is
   * known.
   */
  private AuthControllerLoginV1200ResponseData settleLogin(
      LoginResponse response, HttpServletResponse httpResponse) {
    if (response.getRequiresTenantSelection()) {
      cookies.setTenantSelection(httpResponse, response.getTenantSelectionToken());

      List<TenantOptionResponseDto> tenants =
          response.getTenantsList().stream()
              .map(
                  tenant ->
                      new TenantOptionResponseDto()
                          .organizationId(tenant.getOrganizationId())
                          .name(tenant.getName())
                          .slug(tenant.getSlug()))
              .toList();

      return new TenantSelectionResponseDto().requiresTenantSelection(true).tenants(tenants);
    }

    if (response.getRequiresTwoFactor()) {
      cookies.setTwoFactorToken(httpResponse, response.getTwoFactorToken());

      return new TwoFactorRequiredResponseDto()
          .requiresTwoFactor(true)
          .requiresTwoFactorSetup(response.getRequiresTwoFactorSetup());
    }

    cookies.setAccessToken(httpResponse, response.getAccessToken());
    cookies.setRefreshToken(httpResponse, response.getRefreshToken());

    // The body carries no tokens — HttpOnly cookies are unreadable by JS,
    // which is the entire point.
    return new LoginResponseDto()
        .user(UserMapper.toUserResponseDto(response.getUser()))
        .requiresTwoFactor(false);
  }

  @Override
  public ResponseEntity<AuthControllerLogoutV1200Response> authControllerLogoutV1(
      LogoutDto logoutDto) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    boolean allDevices = Boolean.TRUE.equals(logoutDto.getAllDevices());

    Optional<String> refreshToken = cookies.readRefreshToken(request);
    LogoutResponseDto data;
    if (refreshToken.isPresent()) {
      LogoutRequest wire =
          LogoutRequest.newBuilder()
              .setRefreshToken(refreshToken.get())
              .setAllDevices(allDevices)
              .build();
      synapsedesk.auth.Auth.LogoutResponse response = withMetadata(request).logout(wire);
      data = new LogoutResponseDto().revokedSessionCount(BigDecimal.valueOf(response.getRevokedSessionCount()));
    } else {
      data = new LogoutResponseDto().revokedSessionCount(BigDecimal.ZERO);
    }

    // Cleared unconditionally — the caller asked to be logged out and must
    // not keep holding cookies, even with nothing server-side to revoke.
    cookies.clearSession(httpResponse);
    if (allDevices) {
      cookies.clearDeviceToken(httpResponse);
    }

    return ResponseEntity.ok(
        new AuthControllerLogoutV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(data));
  }

  @Override
  public ResponseEntity<AuthControllerLogoutAllV1200Response> authControllerLogoutAllV1() {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    RequestContext context = currentUser.require(request);

    synapsedesk.auth.Auth.LogoutAllResponse response =
        withMetadata(context).logoutAll(LogoutAllRequest.newBuilder().build());

    cookies.clearSession(httpResponse);
    cookies.clearDeviceToken(httpResponse);

    return ResponseEntity.ok(
        new AuthControllerLogoutAllV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Signed out of all devices")
            .data(
                new LogoutAllResponseDto()
                    .revokedSessionCount(BigDecimal.valueOf(response.getRevokedSessionCount()))));
  }

  @Override
  public ResponseEntity<AuthControllerChangePasswordV1200Response> authControllerChangePasswordV1(
      ChangePasswordDto changePasswordDto) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    ChangePasswordRequest.Builder wire =
        ChangePasswordRequest.newBuilder()
            .setCurrentPassword(changePasswordDto.getCurrentPassword())
            .setNewPassword(changePasswordDto.getNewPassword());
    // Identifies the session to SPARE. Read from the cookie, never the body.
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    synapsedesk.auth.Auth.ChangePasswordResponse response = withMetadata(context).changePassword(wire.build());

    return ResponseEntity.ok(
        new AuthControllerChangePasswordV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("Password changed")
            .data(
                new ChangePasswordResponseDto()
                    .revokedSessionCount(BigDecimal.valueOf(response.getRevokedSessionCount()))));
  }

  @Override
  public ResponseEntity<AuthControllerRefreshV1200Response> authControllerRefreshV1() {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();

    String refreshToken =
        cookies
            .readRefreshToken(request)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No refresh token provided"));

    synapsedesk.auth.Auth.RefreshTokenResponse response =
        withMetadata(request)
            .refreshToken(RefreshTokenRequest.newBuilder().setRefreshToken(refreshToken).build());

    cookies.setAccessToken(httpResponse, response.getAccessToken());
    cookies.setRefreshToken(httpResponse, response.getRefreshToken());

    return ResponseEntity.ok(
        new AuthControllerRefreshV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new LoginResponseDto()
                    .user(UserMapper.toUserResponseDto(response.getUser()))
                    .requiresTwoFactor(false)));
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> authControllerForgotPasswordV1(
      ForgotPasswordDto forgotPasswordDto) {
    HttpServletRequest request = CurrentRequest.request();
    withMetadata(request)
        .forgotPassword(ForgotPasswordRequest.newBuilder().setEmail(forgotPasswordDto.getEmail()).build());

    // Always 202 — see `ForgotPasswordResponse`'s own note: it carries no
    // state, so this cannot become an account-enumeration oracle.
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(
            new AuthControllerForgotPasswordV1202Response()
                .success(true)
                .statusCode(BigDecimal.valueOf(202))
                .message("Accepted"));
  }

  @Override
  public ResponseEntity<AuthControllerValidatePasswordResetTokenV1200Response>
      authControllerValidatePasswordResetTokenV1(String token) {
    HttpServletRequest request = CurrentRequest.request();
    ValidatePasswordResetTokenResponse response =
        withMetadata(request)
            .validatePasswordResetToken(
                ValidatePasswordResetTokenRequest.newBuilder().setToken(token).build());

    return ResponseEntity.ok(
        new AuthControllerValidatePasswordResetTokenV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new ValidatePasswordResetTokenResponseDto()
                    .valid(response.getValid())
                    .email(response.hasEmail() ? response.getEmail() : null)));
  }

  @Override
  public ResponseEntity<AuthControllerResetPasswordV1200Response> authControllerResetPasswordV1(
      ResetPasswordDto resetPasswordDto) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();

    synapsedesk.auth.Auth.ResetPasswordResponse response =
        withMetadata(request)
            .resetPassword(
                ResetPasswordRequest.newBuilder()
                    .setToken(resetPasswordDto.getToken())
                    .setNewPassword(resetPasswordDto.getNewPassword())
                    .build());

    // auth-service just deleted every session for this user, trusted devices
    // included — clear the caller's cookies so the browser matches that.
    cookies.clearAccessToken(httpResponse);
    cookies.clearRefreshToken(httpResponse);
    cookies.clearDeviceToken(httpResponse);

    return ResponseEntity.ok(
        new AuthControllerResetPasswordV1200Response()
            .success(true)
            .statusCode(BigDecimal.valueOf(200))
            .message("OK")
            .data(
                new ResetPasswordResponseDto()
                    .revokedSessionCount(BigDecimal.valueOf(response.getRevokedSessionCount()))));
  }
}

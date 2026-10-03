package com.synapsedesk.gateway.auth;

import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.model.ChangePasswordDto;
import com.synapsedesk.gateway.model.ChangePasswordResponseDto;
import com.synapsedesk.gateway.model.ForgotPasswordDto;
import com.synapsedesk.gateway.model.GoogleSignInDto;
import com.synapsedesk.gateway.model.LoginDto;
import com.synapsedesk.gateway.model.LoginResponseDto;
import com.synapsedesk.gateway.model.LoginWithTenantDto;
import com.synapsedesk.gateway.model.LogoutAllResponseDto;
import com.synapsedesk.gateway.model.LogoutDto;
import com.synapsedesk.gateway.model.LogoutResponseDto;
import com.synapsedesk.gateway.model.RegisterDto;
import com.synapsedesk.gateway.model.RegisterResponseDto;
import com.synapsedesk.gateway.model.ResetPasswordDto;
import com.synapsedesk.gateway.model.ResetPasswordResponseDto;
import com.synapsedesk.gateway.model.TenantOptionResponseDto;
import com.synapsedesk.gateway.model.TenantSelectionResponseDto;
import com.synapsedesk.gateway.model.TwoFactorRequiredResponseDto;
import com.synapsedesk.gateway.model.ValidatePasswordResetTokenResponseDto;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.openapi.RouteSecurity;
import com.synapsedesk.gateway.throttle.AuthThrottle;
import com.synapsedesk.gateway.throttle.RouteThrottle;
import com.synapsedesk.gateway.throttle.ThrottleOverride;
import com.synapsedesk.gateway.throttle.ThrottlerTiers;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.SchemaProperty;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
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
import synapsedesk.auth.AuthServiceGrpc;

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
 *
 * <p><b>Migrated off `AuthApi`</b> — the OpenAPI-ownership flip's first
 * controller. `@RequestMapping` and `@Validated` used to arrive through
 * `implements AuthApi`; both are now declared here directly, since
 * springdoc (not a document Node exports) is this gateway's own document
 * producer and there is no longer an interface to inherit either from. Every
 * return type is {@link ApiResponse}, not a generated per-endpoint wrapper
 * class — see its own docblock for why one generic type replaced ~150 of
 * them.
 *
 * <p><b>`login`/`loginWithTenant`/`googleSignIn` still return {@code
 * ApiResponse<Object>}</b> — Java's erasure gives the THREE-WAY union
 * (`settleLogin`'s fresh session, 2FA challenge, or tenant picker) no
 * sealed-interface equivalent to name as `T`, and this migration is not
 * the place to introduce one. The document does not go unfixed for it,
 * though: each of the three methods carries an explicit {@code
 * @io.swagger.v3.oas.annotations.responses.ApiResponse} that overrides
 * `data`'s inferred schema with the same three-way {@code oneOf} the
 * committed document already declares (`LoginResponseDto` /
 * `TwoFactorRequiredResponseDto` / `TenantSelectionResponseDto`) —
 * `@SchemaProperty` replaces one property of springdoc's auto-inferred
 * envelope schema rather than the whole schema, which is what lets the
 * generic `T = Object` stay untyped in Java while the PUBLISHED document
 * stays exactly as precise as before.
 */
@Tag(name = "Auth")
@RestController
@RequestMapping(ApiPaths.V1)
// Sign-in and session routes are never gated: a member of a frozen workspace must still be able to sign in and be told why.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
@AuthThrottle
public class AuthController {

  private static final long DEADLINE_SECONDS = 5;

  private final AuthServiceGrpc.AuthServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final CookieWriter cookies;
  private final GuestCheck guestCheck;

  public AuthController(
    AuthServiceGrpc.AuthServiceBlockingStub stub,
    CurrentUser currentUser,
    CookieWriter cookies,
    GuestCheck guestCheck
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.cookies = cookies;
    this.guestCheck = guestCheck;
  }

  private AuthServiceGrpc.AuthServiceBlockingStub withMetadata(
    HttpServletRequest request
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        io.grpc.stub.MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(currentUser.origin(request))
        )
      );
  }

  private AuthServiceGrpc.AuthServiceBlockingStub withMetadata(
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

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/register",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  // springdoc infers the documented status from `@ResponseStatus`, never
  // from a runtime `ResponseEntity.status(...)` call — it does not execute
  // the method. Every non-200 route needs this or the document says 200
  // regardless of what actually goes on the wire (measured: absent here,
  // this route documented as 200).
  @ResponseStatus(HttpStatus.CREATED)
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.REGISTER_TTL_MS,
    limit = RouteThrottle.REGISTER_LIMIT
  )
  public ResponseEntity<
    ApiResponse<RegisterResponseDto>
  > authControllerRegisterV1(@Valid @RequestBody RegisterDto registerDto) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    RegisterRequest wire = RegisterRequest.newBuilder()
      .setEmail(registerDto.getEmail())
      .setPassword(registerDto.getPassword())
      .setFullName(registerDto.getFullName())
      .build();
    synapsedesk.auth.Auth.RegisterResponse response = withMetadata(
      request
    ).register(wire);

    RegisterResponseDto data = new RegisterResponseDto()
      .userId(response.getUserId())
      .organizationId(response.getOrganizationId())
      .email(response.getEmail())
      .requiresEmailVerification(response.getRequiresEmailVerification());

    return ResponseEntity.status(HttpStatus.CREATED).body(
      ApiResponse.of(201, "Registered", data)
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/login",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.LOGIN_TTL_MS,
    limit = RouteThrottle.LOGIN_LIMIT
  )
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
    responseCode = "200",
    content = @Content(
      schemaProperties = {
        @SchemaProperty(name = "success", schema = @Schema(type = "boolean")),
        @SchemaProperty(
          name = "statusCode",
          schema = @Schema(type = "integer", format = "int32")
        ),
        @SchemaProperty(name = "message", schema = @Schema(type = "string")),
        @SchemaProperty(
          name = "warning",
          schema = @Schema(types = { "string", "null" })
        ),
        @SchemaProperty(
          name = "data",
          schema = @Schema(
            oneOf = {
              LoginResponseDto.class,
              TwoFactorRequiredResponseDto.class,
              TenantSelectionResponseDto.class,
            }
          )
        ),
      }
    )
  )
  public ResponseEntity<ApiResponse<Object>> authControllerLoginV1(
    @Valid @RequestBody LoginDto loginDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    guestCheck.requireNoActiveSession(request);

    LoginRequest.Builder wire = LoginRequest.newBuilder()
      .setEmail(loginDto.getEmail())
      .setPassword(loginDto.getPassword());
    if (loginDto.getDeviceName() != null) {
      wire.setDeviceName(loginDto.getDeviceName());
    }
    cookies.readDeviceToken(request).ifPresent(wire::setDeviceToken);

    LoginResponse response = withMetadata(request).login(wire.build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        settleLogin(response, CurrentRequest.response())
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/login/tenant",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
    responseCode = "200",
    content = @Content(
      schemaProperties = {
        @SchemaProperty(name = "success", schema = @Schema(type = "boolean")),
        @SchemaProperty(
          name = "statusCode",
          schema = @Schema(type = "integer", format = "int32")
        ),
        @SchemaProperty(name = "message", schema = @Schema(type = "string")),
        @SchemaProperty(
          name = "warning",
          schema = @Schema(types = { "string", "null" })
        ),
        @SchemaProperty(
          name = "data",
          schema = @Schema(
            oneOf = {
              LoginResponseDto.class,
              TwoFactorRequiredResponseDto.class,
              TenantSelectionResponseDto.class,
            }
          )
        ),
      }
    )
  )
  public ResponseEntity<ApiResponse<Object>> authControllerLoginWithTenantV1(
    @Valid @RequestBody LoginWithTenantDto loginWithTenantDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    guestCheck.requireNoActiveSession(request);

    String tenantSelectionToken = cookies
      .readTenantSelectionToken(request)
      .orElseThrow(() ->
        new ResponseStatusException(
          HttpStatus.UNAUTHORIZED,
          "No tenant selection is in progress. Start again from login."
        )
      );

    LoginWithTenantRequest.Builder wire = LoginWithTenantRequest.newBuilder()
      .setTenantSelectionToken(tenantSelectionToken)
      .setOrganizationId(loginWithTenantDto.getOrganizationId().toString());
    if (loginWithTenantDto.getDeviceName() != null) {
      wire.setDeviceName(loginWithTenantDto.getDeviceName());
    }
    cookies.readDeviceToken(request).ifPresent(wire::setDeviceToken);

    LoginResponse response = withMetadata(request).loginWithTenant(
      wire.build()
    );

    // Spent either way — the token named a set of accounts, and one has now
    // been chosen.
    cookies.clearTenantSelection(httpResponse);

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", settleLogin(response, httpResponse))
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/google",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @io.swagger.v3.oas.annotations.responses.ApiResponse(
    responseCode = "200",
    content = @Content(
      schemaProperties = {
        @SchemaProperty(name = "success", schema = @Schema(type = "boolean")),
        @SchemaProperty(
          name = "statusCode",
          schema = @Schema(type = "integer", format = "int32")
        ),
        @SchemaProperty(name = "message", schema = @Schema(type = "string")),
        @SchemaProperty(
          name = "warning",
          schema = @Schema(types = { "string", "null" })
        ),
        @SchemaProperty(
          name = "data",
          schema = @Schema(
            oneOf = {
              LoginResponseDto.class,
              TwoFactorRequiredResponseDto.class,
              TenantSelectionResponseDto.class,
            }
          )
        ),
      }
    )
  )
  public ResponseEntity<ApiResponse<Object>> authControllerGoogleSignInV1(
    @Valid @RequestBody GoogleSignInDto googleSignInDto
  ) {
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
      ApiResponse.of(
        200,
        "OK",
        settleLogin(response, CurrentRequest.response())
      )
    );
  }

  /**
   * The proto's three-way union turned into cookies + a response body —
   * `settleLogin` / `toLoginResult`, reproduced. Tenant selection is checked
   * BEFORE 2FA: 2FA policy is per-tenant, unanswerable until the tenant is
   * known.
   */
  private Object settleLogin(
    LoginResponse response,
    HttpServletResponse httpResponse
  ) {
    if (response.getRequiresTenantSelection()) {
      cookies.setTenantSelection(
        httpResponse,
        response.getTenantSelectionToken()
      );

      List<TenantOptionResponseDto> tenants = response
        .getTenantsList()
        .stream()
        .map(tenant ->
          new TenantOptionResponseDto()
            .organizationId(tenant.getOrganizationId())
            .name(tenant.getName())
            .slug(tenant.getSlug())
        )
        .toList();

      return new TenantSelectionResponseDto()
        .requiresTenantSelection(true)
        .tenants(tenants);
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

  @PostMapping(
    value = "/auth/logout",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<ApiResponse<LogoutResponseDto>> authControllerLogoutV1(
    @Valid @RequestBody LogoutDto logoutDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    boolean allDevices = Boolean.TRUE.equals(logoutDto.getAllDevices());

    Optional<String> refreshToken = cookies.readRefreshToken(request);
    LogoutResponseDto data;
    if (refreshToken.isPresent()) {
      LogoutRequest wire = LogoutRequest.newBuilder()
        .setRefreshToken(refreshToken.get())
        .setAllDevices(allDevices)
        .build();
      synapsedesk.auth.Auth.LogoutResponse response = withMetadata(
        request
      ).logout(wire);
      data = new LogoutResponseDto().revokedSessionCount(
        java.math.BigDecimal.valueOf(response.getRevokedSessionCount())
      );
    } else {
      data = new LogoutResponseDto().revokedSessionCount(
        java.math.BigDecimal.ZERO
      );
    }

    // Cleared unconditionally — the caller asked to be logged out and must
    // not keep holding cookies, even with nothing server-side to revoke.
    cookies.clearSession(httpResponse);
    if (allDevices) {
      cookies.clearDeviceToken(httpResponse);
    }

    return ResponseEntity.ok(ApiResponse.of(200, "OK", data));
  }

  @PostMapping(value = "/auth/logout/all", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<LogoutAllResponseDto>
  > authControllerLogoutAllV1() {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();
    RequestContext context = currentUser.require(request);

    synapsedesk.auth.Auth.LogoutAllResponse response = withMetadata(
      context
    ).logoutAll(LogoutAllRequest.newBuilder().build());

    cookies.clearSession(httpResponse);
    cookies.clearDeviceToken(httpResponse);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Signed out of all devices",
        new LogoutAllResponseDto().revokedSessionCount(
          java.math.BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  @PatchMapping(
    value = "/auth/password",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.CHANGE_PASSWORD_TTL_MS,
    limit = RouteThrottle.CHANGE_PASSWORD_LIMIT
  )
  public ResponseEntity<
    ApiResponse<ChangePasswordResponseDto>
  > authControllerChangePasswordV1(
    @Valid @RequestBody ChangePasswordDto changePasswordDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    RequestContext context = currentUser.require(request);

    ChangePasswordRequest.Builder wire = ChangePasswordRequest.newBuilder()
      .setCurrentPassword(changePasswordDto.getCurrentPassword())
      .setNewPassword(changePasswordDto.getNewPassword());
    // Identifies the session to SPARE. Read from the cookie, never the body.
    cookies.readRefreshToken(request).ifPresent(wire::setRefreshToken);

    synapsedesk.auth.Auth.ChangePasswordResponse response = withMetadata(
      context
    ).changePassword(wire.build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Password changed",
        new ChangePasswordResponseDto().revokedSessionCount(
          java.math.BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.REFRESH_COOKIE)
  @PostMapping(value = "/auth/refresh", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<LoginResponseDto>
  > authControllerRefreshV1() {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();

    String refreshToken = cookies
      .readRefreshToken(request)
      .orElseThrow(() ->
        new ResponseStatusException(
          HttpStatus.UNAUTHORIZED,
          "No refresh token provided"
        )
      );

    synapsedesk.auth.Auth.RefreshTokenResponse response = withMetadata(
      request
    ).refreshToken(
      RefreshTokenRequest.newBuilder().setRefreshToken(refreshToken).build()
    );

    cookies.setAccessToken(httpResponse, response.getAccessToken());
    cookies.setRefreshToken(httpResponse, response.getRefreshToken());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new LoginResponseDto()
          .user(UserMapper.toUserResponseDto(response.getUser()))
          .requiresTwoFactor(false)
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/password/forgot",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @ThrottleOverride(
    tier = ThrottlerTiers.AUTH,
    ttlMs = RouteThrottle.FORGOT_PASSWORD_TTL_MS,
    limit = RouteThrottle.FORGOT_PASSWORD_LIMIT
  )
  public ResponseEntity<ApiResponse<Void>> authControllerForgotPasswordV1(
    @Valid @RequestBody ForgotPasswordDto forgotPasswordDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    withMetadata(request).forgotPassword(
      ForgotPasswordRequest.newBuilder()
        .setEmail(forgotPasswordDto.getEmail())
        .build()
    );

    // Always 202 — see `ForgotPasswordResponse`'s own note: it carries no
    // state, so this cannot become an account-enumeration oracle.
    return ResponseEntity.status(HttpStatus.ACCEPTED).body(
      ApiResponse.of(202, "Accepted", null)
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @GetMapping(
    value = "/auth/password/reset/{token}",
    produces = { "application/json" }
  )
  @ApiErrors({ "401", "404" })
  public ResponseEntity<
    ApiResponse<ValidatePasswordResetTokenResponseDto>
  > authControllerValidatePasswordResetTokenV1(
    @PathVariable("token") String token
  ) {
    HttpServletRequest request = CurrentRequest.request();
    ValidatePasswordResetTokenResponse response = withMetadata(
      request
    ).validatePasswordResetToken(
      ValidatePasswordResetTokenRequest.newBuilder().setToken(token).build()
    );

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new ValidatePasswordResetTokenResponseDto()
          .valid(response.getValid())
          .email(response.hasEmail() ? response.getEmail() : null)
      )
    );
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(
    value = "/auth/password/reset",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<ResetPasswordResponseDto>
  > authControllerResetPasswordV1(
    @Valid @RequestBody ResetPasswordDto resetPasswordDto
  ) {
    HttpServletRequest request = CurrentRequest.request();
    HttpServletResponse httpResponse = CurrentRequest.response();

    synapsedesk.auth.Auth.ResetPasswordResponse response = withMetadata(
      request
    ).resetPassword(
      ResetPasswordRequest.newBuilder()
        .setToken(resetPasswordDto.getToken())
        .setNewPassword(resetPasswordDto.getNewPassword())
        .build()
    );

    // auth-service just deleted every session for this user, trusted devices
    // included — clear the caller's cookies so the browser matches that.
    cookies.clearAccessToken(httpResponse);
    cookies.clearRefreshToken(httpResponse);
    cookies.clearDeviceToken(httpResponse);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new ResetPasswordResponseDto().revokedSessionCount(
          java.math.BigDecimal.valueOf(response.getRevokedSessionCount())
        )
      )
    );
  }
}

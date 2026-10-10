import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AuthServiceController,
  AuthServiceControllerMethods,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  GoogleSignInRequest,
  LoginRequest,
  LoginResponse,
  LoginWithTenantRequest,
  ChangePasswordRequest,
  ChangePasswordResponse,
  LogoutAllResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  ValidatePasswordResetTokenRequest,
  ValidatePasswordResetTokenResponse,
  unpackCallerContext,
  unpackRequestOrigin,
} from '@synapsedesk/grpc-proto';
import { AuthService } from './auth.service';

@Controller()
@AuthServiceControllerMethods()
export class AuthGrpcController implements AuthServiceController {
  constructor(private readonly authService: AuthService) {}

  register(
    request: RegisterRequest,
    metadata?: Metadata,
  ): Promise<RegisterResponse> {
    // The origin is quoted back in the welcome email's "wasn't you?" footer.
    return this.authService.register(request, unpackRequestOrigin(metadata));
  }

  login(request: LoginRequest, metadata?: Metadata): Promise<LoginResponse> {
    return this.authService.login(request, unpackRequestOrigin(metadata));
  }

  googleSignIn(
    request: GoogleSignInRequest,
    metadata?: Metadata,
  ): Promise<LoginResponse> {
    return this.authService.googleSignIn(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  /** The tenant-selection token is what authorizes this, not organization_id. */
  loginWithTenant(
    request: LoginWithTenantRequest,
    metadata?: Metadata,
  ): Promise<LoginResponse> {
    return this.authService.loginWithTenant(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  logout(request: LogoutRequest): Promise<LogoutResponse> {
    return this.authService.logout(request);
  }

  /** The new session records the IP it was rotated from, not the original. */
  refreshToken(
    request: RefreshTokenRequest,
    metadata?: Metadata,
  ): Promise<RefreshTokenResponse> {
    return this.authService.refreshToken(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  forgotPassword(
    request: ForgotPasswordRequest,
    metadata?: Metadata,
  ): Promise<ForgotPasswordResponse> {
    // ip/userAgent are stored on the token row and quoted back in the reset
    // email: "this request came from Chrome on macOS, 203.0.113.7".
    return this.authService.forgotPassword(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  validatePasswordResetToken(
    request: ValidatePasswordResetTokenRequest,
  ): Promise<ValidatePasswordResetTokenResponse> {
    return this.authService.validatePasswordResetToken(request);
  }

  resetPassword(request: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    return this.authService.resetPassword(request);
  }
  /**
   * Unlike `logout`, this is keyed off the AUTHENTICATED caller rather than a
   * presented refresh token — so the full context is unpacked, not just origin.
   */
  logoutAll(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<LogoutAllResponse> {
    return this.authService.logoutAll(unpackCallerContext(metadata));
  }

  changePassword(
    request: ChangePasswordRequest,
    metadata?: Metadata,
  ): Promise<ChangePasswordResponse> {
    return this.authService.changePassword(
      request,
      unpackCallerContext(metadata),
    );
  }
}

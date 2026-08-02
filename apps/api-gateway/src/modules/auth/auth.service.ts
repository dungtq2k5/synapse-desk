import { Injectable } from '@nestjs/common';
import {
  RegisterDto,
  RegisterResponseDto,
} from '../auth/dto/rest/register.dto';
import {
  AuthServiceGrpcClient,
  type LoginResult,
} from './auth-service-grpc.client';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { LoginDto, LoginWithTenantDto } from './dto/rest/login.dto';
import { GoogleSignInDto } from './dto/rest/google-sign-in.dto';
import {
  ChangePasswordDto,
  ResetPasswordResponseDto,
  ValidatePasswordResetTokenResponseDto,
} from './dto/rest/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(private readonly authGrpcClient: AuthServiceGrpcClient) {}

  register(
    registerRequest: RegisterDto,
    origin: RequestOrigin,
  ): Promise<RegisterResponseDto> {
    return this.authGrpcClient.register(registerRequest, origin);
  }

  login(
    loginDto: LoginDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return this.authGrpcClient.login(loginDto, origin, deviceToken);
  }

  googleSignIn(
    dto: GoogleSignInDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return this.authGrpcClient.googleSignIn(dto, origin, deviceToken);
  }

  loginWithTenant(
    dto: LoginWithTenantDto,
    tenantSelectionToken: string,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return this.authGrpcClient.loginWithTenant(
      dto,
      tenantSelectionToken,
      origin,
      deviceToken,
    );
  }

  logout(
    refreshToken: string,
    allDevices: boolean,
    origin: RequestOrigin,
  ): Promise<number> {
    return this.authGrpcClient.logout(refreshToken, allDevices, origin);
  }

  logoutAll(context: RequestContext): Promise<number> {
    return this.authGrpcClient.logoutAll(context);
  }

  changePassword(
    dto: ChangePasswordDto,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<number> {
    return this.authGrpcClient.changePassword(dto, refreshToken, context);
  }

  refreshToken(refreshToken: string, origin: RequestOrigin) {
    return this.authGrpcClient.refreshToken(refreshToken, origin);
  }

  forgotPassword(email: string, origin: RequestOrigin): Promise<void> {
    return this.authGrpcClient.forgotPassword(email, origin);
  }

  validatePasswordResetToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<ValidatePasswordResetTokenResponseDto> {
    return this.authGrpcClient.validatePasswordResetToken(token, origin);
  }

  resetPassword(
    token: string,
    newPassword: string,
    origin: RequestOrigin,
  ): Promise<ResetPasswordResponseDto> {
    return this.authGrpcClient.resetPassword(token, newPassword, origin);
  }
}

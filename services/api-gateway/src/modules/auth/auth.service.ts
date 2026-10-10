import { Injectable } from '@nestjs/common';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { AuthServiceGrpcClient } from './auth-service-grpc.client';
import {
  type LoginResult,
  type RefreshResult,
  toLoginResult,
  toRefreshResult,
  toRegisterResponseDto,
  toValidatePasswordResetTokenResponseDto,
} from './auth.mapper';
import { RegisterDto } from '../auth/dto/rest/register.dto';
import { RegisterResponseDto } from '../auth/dto/rest/register-response.dto';
import { LoginDto, LoginWithTenantDto } from './dto/rest/login.dto';
import { GoogleSignInDto } from './dto/rest/google-sign-in.dto';
import {
  LogoutAllResponseDto,
  LogoutResponseDto,
} from './dto/rest/logout-response.dto';
import { ChangePasswordDto } from './dto/rest/reset-password.dto';
import {
  ChangePasswordResponseDto,
  ResetPasswordResponseDto,
  ValidatePasswordResetTokenResponseDto,
} from './dto/rest/reset-password-response.dto';

export type { LoginResult, RefreshResult } from './auth.mapper';

/** The gateway's auth surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class AuthService {
  constructor(private readonly authGrpcClient: AuthServiceGrpcClient) {}

  async register(
    dto: RegisterDto,
    origin: RequestOrigin,
  ): Promise<RegisterResponseDto> {
    return toRegisterResponseDto(
      await this.authGrpcClient.register(
        { email: dto.email, password: dto.password, fullName: dto.fullName },
        origin,
      ),
    );
  }

  /** @param deviceToken From the HttpOnly cookie, never from the request body. */
  async login(
    dto: LoginDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return toLoginResult(
      await this.authGrpcClient.login(
        {
          email: dto.email,
          password: dto.password,
          deviceName: dto.deviceName,
          deviceToken,
        },
        origin,
      ),
    );
  }

  async googleSignIn(
    dto: GoogleSignInDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return toLoginResult(
      await this.authGrpcClient.googleSignIn(
        { idToken: dto.idToken, deviceName: dto.deviceName, deviceToken },
        origin,
      ),
    );
  }

  async loginWithTenant(
    dto: LoginWithTenantDto,
    tenantSelectionToken: string,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    return toLoginResult(
      await this.authGrpcClient.loginWithTenant(
        {
          tenantSelectionToken,
          organizationId: dto.organizationId,
          deviceName: dto.deviceName,
          deviceToken,
        },
        origin,
      ),
    );
  }

  logout(
    refreshToken: string,
    allDevices: boolean,
    origin: RequestOrigin,
  ): Promise<LogoutResponseDto> {
    return this.authGrpcClient.logout(refreshToken, allDevices, origin);
  }

  logoutAll(context: RequestContext): Promise<LogoutAllResponseDto> {
    return this.authGrpcClient.logoutAll(context);
  }

  /** @param refreshToken Identifies the ONE session the change spares. */
  changePassword(
    dto: ChangePasswordDto,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<ChangePasswordResponseDto> {
    return this.authGrpcClient.changePassword(
      {
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
        refreshToken,
      },
      context,
    );
  }

  async refreshToken(
    refreshToken: string,
    origin: RequestOrigin,
  ): Promise<RefreshResult> {
    return toRefreshResult(
      await this.authGrpcClient.refreshToken(refreshToken, origin),
    );
  }

  forgotPassword(email: string, origin: RequestOrigin): Promise<void> {
    return this.authGrpcClient.forgotPassword(email, origin);
  }

  async validatePasswordResetToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<ValidatePasswordResetTokenResponseDto> {
    return toValidatePasswordResetTokenResponseDto(
      await this.authGrpcClient.validatePasswordResetToken(token, origin),
    );
  }

  resetPassword(
    token: string,
    newPassword: string,
    origin: RequestOrigin,
  ): Promise<ResetPasswordResponseDto> {
    return this.authGrpcClient.resetPassword(token, newPassword, origin);
  }
}

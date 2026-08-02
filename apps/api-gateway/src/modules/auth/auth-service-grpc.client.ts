import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  AUTH_SERVICE_NAME,
  AuthServiceClient,
  type LoginResponse as ProtoLoginResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { RegisterDto, RegisterResponseDto } from './dto/rest/register.dto';
import {
  LoginDto,
  LoginWithTenantDto,
  TenantOptionDto,
} from './dto/rest/login.dto';
import { GoogleSignInDto } from './dto/rest/google-sign-in.dto';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import { toUserResponseDto } from '../users/user.mapper';
import {
  ResetPasswordResponseDto,
  ValidatePasswordResetTokenResponseDto,
} from './dto/rest/reset-password.dto';

/**
 * Result of a login, discriminated exactly as the proto is.
 *
 * THREE shapes, and callers must branch on `requiresTenantSelection` FIRST:
 * 2FA policy is a per-tenant setting, so it cannot be evaluated until the
 * tenant is known.
 */
export type LoginResult =
  | {
      requiresTenantSelection: true;
      tenantSelectionToken: string;
      tenants: TenantOptionDto[];
    }
  | {
      requiresTenantSelection: false;
      requiresTwoFactor: true;
      /**
       * The challenge is an ENROLMENT one: the tenant requires 2FA and this
       * account has none yet, so the client must open setup rather than prompt
       * for a code that does not exist.
       */
      requiresTwoFactorSetup: boolean;
      twoFactorToken: string;
    }
  | {
      requiresTenantSelection: false;
      requiresTwoFactor: false;
      user: UserResponseDto;
      accessToken: string;
      refreshToken: string;
    };

/**
 * The proto's three-way union, unpacked once so every caller of `login` and
 * `googleSignIn` branches identically instead of re-deriving the precedence.
 */
function toLoginResult(response: ProtoLoginResponse): LoginResult {
  if (response.requiresTenantSelection) {
    return {
      requiresTenantSelection: true,
      tenantSelectionToken: response.tenantSelectionToken ?? '',
      tenants: response.tenants.map((tenant) => ({
        organizationId: tenant.organizationId,
        name: tenant.name,
        slug: tenant.slug,
      })),
    };
  }

  if (response.requiresTwoFactor) {
    return {
      requiresTenantSelection: false,
      requiresTwoFactor: true,
      requiresTwoFactorSetup: response.requiresTwoFactorSetup,
      twoFactorToken: response.twoFactorToken ?? '',
    };
  }

  return {
    requiresTenantSelection: false,
    requiresTwoFactor: false,
    user: toUserResponseDto(response.user!),
    accessToken: response.accessToken ?? '',
    refreshToken: response.refreshToken ?? '',
  };
}

/**
 * Transport adapter for auth-service.
 *
 * This is the ONLY file in the gateway allowed to import from
 * `@synapsedesk/grpc-proto`. It takes gateway DTOs in and returns gateway DTOs
 * out, so a rename inside auth.proto surfaces as a compile error here rather
 * than silently changing the public REST contract. The proto's `undefined` ->
 * REST `null` conversion lives here too, in `user.mapper.ts`.
 */
@Injectable()
export class AuthServiceGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private authGrpcService!: AuthServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.authGrpcService =
      this.client.getService<AuthServiceClient>(AUTH_SERVICE_NAME);
  }

  async register(
    registerDto: RegisterDto,
    origin: RequestOrigin,
  ): Promise<RegisterResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.register(
          {
            email: registerDto.email,
            password: registerDto.password,
            fullName: registerDto.fullName,
          },
          metadata,
        ),
      origin,
    );

    return {
      userId: response.userId,
      organizationId: response.organizationId,
      email: response.email,
      requiresEmailVerification: response.requiresEmailVerification,
    };
  }

  async login(
    loginDto: LoginDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.login(
          {
            email: loginDto.email,
            password: loginDto.password,
            deviceName: loginDto.deviceName,
            // From the HttpOnly cookie, never from the request body.
            deviceToken,
          },
          metadata,
        ),
      origin,
    );

    return toLoginResult(response);
  }

  async googleSignIn(
    dto: GoogleSignInDto,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.googleSignIn(
          {
            idToken: dto.idToken,
            deviceName: dto.deviceName,
            deviceToken,
          },
          metadata,
        ),
      origin,
    );

    return toLoginResult(response);
  }

  async loginWithTenant(
    dto: LoginWithTenantDto,
    tenantSelectionToken: string,
    origin: RequestOrigin,
    deviceToken: string | undefined,
  ): Promise<LoginResult> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.loginWithTenant(
          {
            tenantSelectionToken,
            organizationId: dto.organizationId,
            deviceName: dto.deviceName,
            deviceToken,
          },
          metadata,
        ),
      origin,
    );

    return toLoginResult(response);
  }

  async logout(
    refreshToken: string,
    allDevices: boolean,
    origin: RequestOrigin,
  ): Promise<number> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.logout({ refreshToken, allDevices }, metadata),
      origin,
    );

    return response.revokedSessionCount;
  }

  /**
   * Takes the full `RequestContext`, not an origin: the RPC is keyed off the
   * authenticated caller rather than a presented refresh token, so the identity
   * has to cross the hop.
   */
  async logoutAll(context: RequestContext): Promise<number> {
    const response = await this.call(
      (metadata) => this.authGrpcService.logoutAll({}, metadata),
      context,
    );

    return response.revokedSessionCount;
  }

  async changePassword(
    dto: { currentPassword: string; newPassword: string },
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<number> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.changePassword(
          {
            currentPassword: dto.currentPassword,
            newPassword: dto.newPassword,
            // Identifies the ONE session the change spares.
            refreshToken,
          },
          metadata,
        ),
      context,
    );

    return response.revokedSessionCount;
  }

  async refreshToken(
    refreshToken: string,
    origin: RequestOrigin,
  ): Promise<{
    user: UserResponseDto;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.refreshToken({ refreshToken }, metadata),
      origin,
    );

    return {
      user: toUserResponseDto(response.user!),
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    };
  }

  async forgotPassword(email: string, origin: RequestOrigin): Promise<void> {
    await this.call(
      (metadata) => this.authGrpcService.forgotPassword({ email }, metadata),
      origin,
    );
  }

  async validatePasswordResetToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<ValidatePasswordResetTokenResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.validatePasswordResetToken({ token }, metadata),
      origin,
    );

    return { valid: response.valid, email: response.email ?? null };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    origin: RequestOrigin,
  ): Promise<ResetPasswordResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.authGrpcService.resetPassword({ token, newPassword }, metadata),
      origin,
    );

    return { revokedSessionCount: response.revokedSessionCount };
  }
}

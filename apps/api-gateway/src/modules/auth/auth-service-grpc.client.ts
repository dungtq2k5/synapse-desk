import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  AUTH_SERVICE_NAME,
  AuthServiceClient,
  ChangePasswordRequest,
  ChangePasswordResponse,
  GoogleSignInRequest,
  LoginRequest,
  type LoginResponse as ProtoLoginResponse,
  LoginWithTenantRequest,
  LogoutResponse,
  RefreshTokenResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordResponse,
  ValidatePasswordResetTokenResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * Transport adapter for auth-service.
 *
 * Takes and returns proto messages; `auth.mapper.ts` converts them and
 * `AuthService` composes. The proto's `undefined` ->
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

  register(
    request: RegisterRequest,
    origin: RequestOrigin,
  ): Promise<RegisterResponse> {
    return this.call(
      (metadata) => this.authGrpcService.register(request, metadata),
      origin,
    );
  }

  login(
    request: LoginRequest,
    origin: RequestOrigin,
  ): Promise<ProtoLoginResponse> {
    return this.call(
      (metadata) => this.authGrpcService.login(request, metadata),
      origin,
    );
  }

  googleSignIn(
    request: GoogleSignInRequest,
    origin: RequestOrigin,
  ): Promise<ProtoLoginResponse> {
    return this.call(
      (metadata) => this.authGrpcService.googleSignIn(request, metadata),
      origin,
    );
  }

  loginWithTenant(
    request: LoginWithTenantRequest,
    origin: RequestOrigin,
  ): Promise<ProtoLoginResponse> {
    return this.call(
      (metadata) => this.authGrpcService.loginWithTenant(request, metadata),
      origin,
    );
  }

  logout(
    refreshToken: string,
    allDevices: boolean,
    origin: RequestOrigin,
  ): Promise<LogoutResponse> {
    return this.call(
      (metadata) =>
        this.authGrpcService.logout({ refreshToken, allDevices }, metadata),
      origin,
    );
  }

  /**
   * Takes the full `RequestContext`, not an origin: the RPC is keyed off the
   * authenticated caller rather than a presented refresh token, so the identity
   * has to cross the hop.
   */
  logoutAll(context: RequestContext): Promise<LogoutResponse> {
    return this.call(
      (metadata) => this.authGrpcService.logoutAll({}, metadata),
      context,
    );
  }

  changePassword(
    request: ChangePasswordRequest,
    context: RequestContext,
  ): Promise<ChangePasswordResponse> {
    return this.call(
      (metadata) => this.authGrpcService.changePassword(request, metadata),
      context,
    );
  }

  refreshToken(
    refreshToken: string,
    origin: RequestOrigin,
  ): Promise<RefreshTokenResponse> {
    return this.call(
      (metadata) =>
        this.authGrpcService.refreshToken({ refreshToken }, metadata),
      origin,
    );
  }

  async forgotPassword(email: string, origin: RequestOrigin): Promise<void> {
    await this.call(
      (metadata) => this.authGrpcService.forgotPassword({ email }, metadata),
      origin,
    );
  }

  validatePasswordResetToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<ValidatePasswordResetTokenResponse> {
    return this.call(
      (metadata) =>
        this.authGrpcService.validatePasswordResetToken({ token }, metadata),
      origin,
    );
  }

  resetPassword(
    token: string,
    newPassword: string,
    origin: RequestOrigin,
  ): Promise<ResetPasswordResponse> {
    return this.call(
      (metadata) =>
        this.authGrpcService.resetPassword({ token, newPassword }, metadata),
      origin,
    );
  }
}

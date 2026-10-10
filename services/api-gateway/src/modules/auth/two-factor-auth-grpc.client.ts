import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  ActivateTwoFactorResponse,
  AuthenticateTwoFactorRequest,
  AuthenticateTwoFactorResponse,
  AUTH_GRPC_CLIENT,
  BackupCodesStatusResponse,
  GenerateTwoFactorResponse,
  RegenerateBackupCodesResponse,
  TWO_FACTOR_AUTH_SERVICE_NAME,
  TwoFactorAuthServiceClient,
} from '@synapsedesk/grpc-proto';
import { RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/** Transport for `TwoFactorAuthService`. Returns proto messages; mapping is `two-factor-auth.mapper.ts`. */
@Injectable()
export class TwoFactorAuthGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private twoFactorGrpcService!: TwoFactorAuthServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.twoFactorGrpcService =
      this.client.getService<TwoFactorAuthServiceClient>(
        TWO_FACTOR_AUTH_SERVICE_NAME,
      );
  }

  generateTwoFactor(
    userId: string,
    origin: RequestOrigin,
  ): Promise<GenerateTwoFactorResponse> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.generateTwoFactor({ userId }, metadata),
      origin,
    );
  }

  activateTwoFactor(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<ActivateTwoFactorResponse> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.activateTwoFactor({ userId, code }, metadata),
      origin,
    );
  }

  authenticateTwoFactor(
    request: AuthenticateTwoFactorRequest,
    origin: RequestOrigin,
  ): Promise<AuthenticateTwoFactorResponse> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.authenticateTwoFactor(request, metadata),
      origin,
    );
  }

  async disableTwoFactor(
    userId: string,
    code: string,
    password: string,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.twoFactorGrpcService.disableTwoFactor(
          { userId, code, password },
          metadata,
        ),
      origin,
    );
  }

  regenerateBackupCodes(
    userId: string,
    password: string,
    origin: RequestOrigin,
  ): Promise<RegenerateBackupCodesResponse> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.regenerateBackupCodes(
          { userId, password },
          metadata,
        ),
      origin,
    );
  }

  getBackupCodesStatus(
    userId: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesStatusResponse> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.getBackupCodesStatus({ userId }, metadata),
      origin,
    );
  }
}

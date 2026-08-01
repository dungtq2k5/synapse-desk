import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  fromTimestamp,
  TWO_FACTOR_AUTH_SERVICE_NAME,
  TwoFactorAuthServiceClient,
} from '@synapsedesk/grpc-proto';
import { RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import {
  AuthenticateTwoFactorDto,
  BackupCodesStatusResponseDto,
  DisableTwoFactorDto,
  GenerateTwoFactorResponseDto,
} from './dto/rest/two-factor.dto';

/** Everything the controller needs to set cookies and shape the body. */
export type TwoFactorAuthenticateResult = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
  deviceToken: string | null;
  warning: string | null;
};

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
  ): Promise<GenerateTwoFactorResponseDto> {
    return this.call(
      (metadata) =>
        this.twoFactorGrpcService.generateTwoFactor({ userId }, metadata),
      origin,
    );
  }

  async activateTwoFactor(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<string[]> {
    const response = await this.call(
      (metadata) =>
        this.twoFactorGrpcService.activateTwoFactor({ userId, code }, metadata),
      origin,
    );

    return response.backupCodes;
  }

  async authenticateTwoFactor(
    twoFactorToken: string,
    dto: AuthenticateTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<TwoFactorAuthenticateResult> {
    const response = await this.call(
      (metadata) =>
        this.twoFactorGrpcService.authenticateTwoFactor(
          {
            twoFactorToken,
            code: dto.code,
            backupCode: dto.backupCode,
            rememberDevice: dto.rememberDevice ?? false,
            deviceName: dto.deviceName,
          },
          metadata,
        ),
      origin,
    );

    return {
      user: toUserResponseDto(response.user!),
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      deviceToken: response.deviceToken ?? null,
      warning: response.warning ?? null,
    };
  }

  async disableTwoFactor(
    userId: string,
    dto: DisableTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.twoFactorGrpcService.disableTwoFactor(
          { userId, code: dto.code, password: dto.password },
          metadata,
        ),
      origin,
    );
  }

  async regenerateBackupCodes(
    userId: string,
    password: string,
    origin: RequestOrigin,
  ): Promise<string[]> {
    const response = await this.call(
      (metadata) =>
        this.twoFactorGrpcService.regenerateBackupCodes(
          { userId, password },
          metadata,
        ),
      origin,
    );

    return response.backupCodes;
  }

  async getBackupCodesStatus(
    userId: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesStatusResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.twoFactorGrpcService.getBackupCodesStatus({ userId }, metadata),
      origin,
    );

    return {
      remaining: response.remaining,
      used: response.used,
      expiresAt: fromTimestamp(response.expiresAt) ?? null,
    };
  }
}

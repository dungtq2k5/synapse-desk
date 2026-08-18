import { Injectable } from '@nestjs/common';
import { RequestOrigin } from '@synapsedesk/common';
import { TwoFactorAuthGrpcClient } from './two-factor-auth-grpc.client';
import {
  toBackupCodesStatusDto,
  toTwoFactorAuthenticateResult,
  TwoFactorAuthenticateResult,
} from './two-factor-auth.mapper';
import {
  AuthenticateTwoFactorDto,
  DisableTwoFactorDto,
} from './dto/rest/two-factor.dto';
import {
  BackupCodesResponseDto,
  BackupCodesStatusResponseDto,
  GenerateTwoFactorResponseDto,
} from './dto/rest/two-factor-response.dto';

/** The gateway's two-factor surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class TwoFactorAuthService {
  constructor(private readonly twoFactorGrpcClient: TwoFactorAuthGrpcClient) {}

  generate(
    userId: string,
    origin: RequestOrigin,
  ): Promise<GenerateTwoFactorResponseDto> {
    return this.twoFactorGrpcClient.generateTwoFactor(userId, origin);
  }

  activate(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesResponseDto> {
    return this.twoFactorGrpcClient.activateTwoFactor(userId, code, origin);
  }

  async authenticate(
    twoFactorToken: string,
    dto: AuthenticateTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<TwoFactorAuthenticateResult> {
    return toTwoFactorAuthenticateResult(
      await this.twoFactorGrpcClient.authenticateTwoFactor(
        {
          twoFactorToken,
          code: dto.code,
          backupCode: dto.backupCode,
          rememberDevice: dto.rememberDevice ?? false,
          deviceName: dto.deviceName,
        },
        origin,
      ),
    );
  }

  disable(
    userId: string,
    dto: DisableTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<void> {
    return this.twoFactorGrpcClient.disableTwoFactor(
      userId,
      dto.code,
      dto.password,
      origin,
    );
  }

  regenerateBackupCodes(
    userId: string,
    password: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesResponseDto> {
    return this.twoFactorGrpcClient.regenerateBackupCodes(
      userId,
      password,
      origin,
    );
  }

  async getBackupCodesStatus(
    userId: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesStatusResponseDto> {
    return toBackupCodesStatusDto(
      await this.twoFactorGrpcClient.getBackupCodesStatus(userId, origin),
    );
  }
}

import { Injectable } from '@nestjs/common';
import { RequestOrigin } from '@synapsedesk/contracts';
import { TwoFactorAuthGrpcClient } from './two-factor-auth-grpc.client';
import {
  toBackupCodesStatusResponseDto,
  toTwoFactorAuthenticateResult,
  toTwoFactorEnabledResult,
  TwoFactorAuthenticateResult,
  TwoFactorEnabledResult,
} from './two-factor-auth.mapper';
import {
  ActivateTwoFactorDto,
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

  /**
   * Enables two-step. With the sign-in challenge (`twoFactorToken`), the
   * accepted code also signs the caller in: auth-service verifies the token
   * again and answers the session.
   */
  async activate(
    userId: string,
    dto: ActivateTwoFactorDto,
    twoFactorToken: string | undefined,
    origin: RequestOrigin,
  ): Promise<TwoFactorEnabledResult> {
    return toTwoFactorEnabledResult(
      await this.twoFactorGrpcClient.activateTwoFactor(
        twoFactorToken
          ? {
              userId,
              code: dto.code,
              twoFactorToken,
              deviceName: dto.deviceName,
            }
          : { userId, code: dto.code },
        origin,
      ),
    );
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
    return toBackupCodesStatusResponseDto(
      await this.twoFactorGrpcClient.getBackupCodesStatus(userId, origin),
    );
  }
}

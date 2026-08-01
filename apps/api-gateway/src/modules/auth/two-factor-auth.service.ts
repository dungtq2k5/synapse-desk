import { Injectable } from '@nestjs/common';
import { RequestOrigin } from '@synapsedesk/common';
import {
  TwoFactorAuthenticateResult,
  TwoFactorAuthGrpcClient,
} from './two-factor-auth-grpc.client';
import {
  AuthenticateTwoFactorDto,
  BackupCodesStatusResponseDto,
  DisableTwoFactorDto,
  GenerateTwoFactorResponseDto,
} from './dto/rest/two-factor.dto';

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
  ): Promise<string[]> {
    return this.twoFactorGrpcClient.activateTwoFactor(userId, code, origin);
  }

  authenticate(
    twoFactorToken: string,
    dto: AuthenticateTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<TwoFactorAuthenticateResult> {
    return this.twoFactorGrpcClient.authenticateTwoFactor(
      twoFactorToken,
      dto,
      origin,
    );
  }

  disable(
    userId: string,
    dto: DisableTwoFactorDto,
    origin: RequestOrigin,
  ): Promise<void> {
    return this.twoFactorGrpcClient.disableTwoFactor(userId, dto, origin);
  }

  regenerateBackupCodes(
    userId: string,
    password: string,
    origin: RequestOrigin,
  ): Promise<string[]> {
    return this.twoFactorGrpcClient.regenerateBackupCodes(
      userId,
      password,
      origin,
    );
  }

  getBackupCodesStatus(
    userId: string,
    origin: RequestOrigin,
  ): Promise<BackupCodesStatusResponseDto> {
    return this.twoFactorGrpcClient.getBackupCodesStatus(userId, origin);
  }
}

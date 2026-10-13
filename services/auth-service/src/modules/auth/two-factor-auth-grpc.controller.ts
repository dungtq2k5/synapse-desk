import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ActivateTwoFactorRequest,
  ActivateTwoFactorResponse,
  AuthenticateTwoFactorRequest,
  AuthenticateTwoFactorResponse,
  BackupCodesStatusRequest,
  BackupCodesStatusResponse,
  DisableTwoFactorRequest,
  DisableTwoFactorResponse,
  GenerateTwoFactorRequest,
  GenerateTwoFactorResponse,
  RegenerateBackupCodesRequest,
  RegenerateBackupCodesResponse,
  TwoFactorAuthServiceController,
  TwoFactorAuthServiceControllerMethods,
  unpackRequestOrigin,
} from '@synapsedesk/grpc-proto';
import { TwoFactorAuthService } from './two-factor-auth.service';

@Controller()
@TwoFactorAuthServiceControllerMethods()
export class TwoFactorAuthGrpcController implements TwoFactorAuthServiceController {
  constructor(private readonly twoFactorAuthService: TwoFactorAuthService) {}

  generateTwoFactor(
    request: GenerateTwoFactorRequest,
  ): Promise<GenerateTwoFactorResponse> {
    return this.twoFactorAuthService.generateTwoFactor(request);
  }

  activateTwoFactor(
    request: ActivateTwoFactorRequest,
    metadata?: Metadata,
  ): Promise<ActivateTwoFactorResponse> {
    return this.twoFactorAuthService.activateTwoFactor(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  /**
   * Takes the origin, as `activateTwoFactor` does: both can create a
   * `device_sessions` row, which records the IP and user-agent the session was
   * born on.
   */
  authenticateTwoFactor(
    request: AuthenticateTwoFactorRequest,
    metadata?: Metadata,
  ): Promise<AuthenticateTwoFactorResponse> {
    return this.twoFactorAuthService.authenticateTwoFactor(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  disableTwoFactor(
    request: DisableTwoFactorRequest,
  ): Promise<DisableTwoFactorResponse> {
    return this.twoFactorAuthService.disableTwoFactor(request);
  }

  regenerateBackupCodes(
    request: RegenerateBackupCodesRequest,
  ): Promise<RegenerateBackupCodesResponse> {
    return this.twoFactorAuthService.regenerateBackupCodes(request);
  }

  getBackupCodesStatus(
    request: BackupCodesStatusRequest,
  ): Promise<BackupCodesStatusResponse> {
    return this.twoFactorAuthService.getBackupCodesStatus(request);
  }
}

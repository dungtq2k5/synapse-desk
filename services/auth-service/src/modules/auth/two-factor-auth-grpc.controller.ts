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
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { requireSelf } from '@synapsedesk/nest-common';

@Controller()
@TwoFactorAuthServiceControllerMethods()
export class TwoFactorAuthGrpcController implements TwoFactorAuthServiceController {
  constructor(private readonly twoFactorAuthService: TwoFactorAuthService) {}

  generateTwoFactor(
    request: GenerateTwoFactorRequest,
    metadata?: Metadata,
  ): Promise<GenerateTwoFactorResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.twoFactorAuthService.generateTwoFactor(request);
  }

  activateTwoFactor(
    request: ActivateTwoFactorRequest,
    metadata?: Metadata,
  ): Promise<ActivateTwoFactorResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
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
    metadata?: Metadata,
  ): Promise<DisableTwoFactorResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.twoFactorAuthService.disableTwoFactor(request);
  }

  regenerateBackupCodes(
    request: RegenerateBackupCodesRequest,
    metadata?: Metadata,
  ): Promise<RegenerateBackupCodesResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.twoFactorAuthService.regenerateBackupCodes(request);
  }

  getBackupCodesStatus(
    request: BackupCodesStatusRequest,
    metadata?: Metadata,
  ): Promise<BackupCodesStatusResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.twoFactorAuthService.getBackupCodesStatus(request);
  }
}

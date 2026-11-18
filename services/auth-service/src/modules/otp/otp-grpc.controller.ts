import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import { requireSelf } from '@synapsedesk/nest-common';
import {
  OtpServiceController,
  OtpServiceControllerMethods,
  OtpStatusRequest,
  OtpStatusResponse,
  RequestEmailVerificationRequest,
  RequestOtpResponse,
  RequestPhoneVerificationRequest,
  VerifyOtpRequest,
  VerifyOtpResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { OtpService } from './otp.service';

@Controller()
@OtpServiceControllerMethods()
export class OtpGrpcController implements OtpServiceController {
  constructor(private readonly otpService: OtpService) {}

  requestEmailVerification(
    request: RequestEmailVerificationRequest,
    metadata?: Metadata,
  ): Promise<RequestOtpResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.otpService.requestEmailVerification(request);
  }

  verifyEmail(
    request: VerifyOtpRequest,
    metadata?: Metadata,
  ): Promise<VerifyOtpResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.otpService.verifyEmail(request);
  }

  requestPhoneVerification(
    request: RequestPhoneVerificationRequest,
    metadata?: Metadata,
  ): Promise<RequestOtpResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.otpService.requestPhoneVerification(request);
  }

  verifyPhone(
    request: VerifyOtpRequest,
    metadata?: Metadata,
  ): Promise<VerifyOtpResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.otpService.verifyPhone(request);
  }

  getOtpStatus(
    request: OtpStatusRequest,
    metadata?: Metadata,
  ): Promise<OtpStatusResponse> {
    requireSelf(unpackCallerContext(metadata), request.userId);
    return this.otpService.getOtpStatus(request);
  }
}

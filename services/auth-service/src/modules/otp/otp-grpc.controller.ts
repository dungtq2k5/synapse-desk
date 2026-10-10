import { Controller } from '@nestjs/common';
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
} from '@synapsedesk/grpc-proto';
import { OtpService } from './otp.service';

@Controller()
@OtpServiceControllerMethods()
export class OtpGrpcController implements OtpServiceController {
  constructor(private readonly otpService: OtpService) {}

  requestEmailVerification(
    request: RequestEmailVerificationRequest,
  ): Promise<RequestOtpResponse> {
    return this.otpService.requestEmailVerification(request);
  }

  verifyEmail(request: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    return this.otpService.verifyEmail(request);
  }

  requestPhoneVerification(
    request: RequestPhoneVerificationRequest,
  ): Promise<RequestOtpResponse> {
    return this.otpService.requestPhoneVerification(request);
  }

  verifyPhone(request: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    return this.otpService.verifyPhone(request);
  }

  getOtpStatus(request: OtpStatusRequest): Promise<OtpStatusResponse> {
    return this.otpService.getOtpStatus(request);
  }
}

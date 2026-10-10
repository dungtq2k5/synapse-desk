import { Injectable } from '@nestjs/common';
import { OtpPurpose, RequestOrigin } from '@synapsedesk/common';
import { OtpGrpcClient } from './otp-grpc.client';
import { toOtpStatusResponseDto } from './otp.mapper';
import {
  OtpStatusResponseDto,
  RequestOtpResponseDto,
  VerifyOtpResponseDto,
} from '../auth/dto/rest/otp-response.dto';

/** The gateway's OTP surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class OtpService {
  constructor(private readonly otpGrpcClient: OtpGrpcClient) {}

  requestEmailVerification(
    userId: string,
    origin: RequestOrigin,
  ): Promise<RequestOtpResponseDto> {
    return this.otpGrpcClient.requestEmailVerification(userId, origin);
  }

  verifyEmail(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<VerifyOtpResponseDto> {
    return this.otpGrpcClient.verifyEmail(userId, code, origin);
  }

  requestPhoneVerification(
    userId: string,
    phoneNumber: string,
    origin: RequestOrigin,
  ): Promise<RequestOtpResponseDto> {
    return this.otpGrpcClient.requestPhoneVerification(
      userId,
      phoneNumber,
      origin,
    );
  }

  verifyPhone(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<VerifyOtpResponseDto> {
    return this.otpGrpcClient.verifyPhone(userId, code, origin);
  }

  async getOtpStatus(
    userId: string,
    purpose: OtpPurpose,
    origin: RequestOrigin,
  ): Promise<OtpStatusResponseDto> {
    return toOtpStatusResponseDto(
      await this.otpGrpcClient.getOtpStatus(userId, purpose, origin),
    );
  }
}

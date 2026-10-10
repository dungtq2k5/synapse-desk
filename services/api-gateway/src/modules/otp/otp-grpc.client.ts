import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  OTP_SERVICE_NAME,
  OtpStatusResponse,
  RequestOtpResponse,
  VerifyOtpResponse,
  OtpServiceClient,
  toProtoOtpPurpose,
} from '@synapsedesk/grpc-proto';
import { OtpPurpose, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class OtpGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'auth-service';

  private otpGrpcService!: OtpServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.otpGrpcService =
      this.client.getService<OtpServiceClient>(OTP_SERVICE_NAME);
  }

  requestEmailVerification(
    userId: string,
    origin: RequestOrigin,
  ): Promise<RequestOtpResponse> {
    return this.call(
      (metadata) =>
        this.otpGrpcService.requestEmailVerification({ userId }, metadata),
      origin,
    );
  }

  verifyEmail(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<VerifyOtpResponse> {
    return this.call(
      (metadata) => this.otpGrpcService.verifyEmail({ userId, code }, metadata),
      origin,
    );
  }

  requestPhoneVerification(
    userId: string,
    phoneNumber: string,
    origin: RequestOrigin,
  ): Promise<RequestOtpResponse> {
    return this.call(
      (metadata) =>
        this.otpGrpcService.requestPhoneVerification(
          { userId, phoneNumber },
          metadata,
        ),
      origin,
    );
  }

  verifyPhone(
    userId: string,
    code: string,
    origin: RequestOrigin,
  ): Promise<VerifyOtpResponse> {
    return this.call(
      (metadata) => this.otpGrpcService.verifyPhone({ userId, code }, metadata),
      origin,
    );
  }

  getOtpStatus(
    userId: string,
    purpose: OtpPurpose,
    origin: RequestOrigin,
  ): Promise<OtpStatusResponse> {
    return this.call(
      (metadata) =>
        this.otpGrpcService.getOtpStatus(
          // Domain enum -> proto enum happens here, at the transport boundary,
          // so neither the REST contract nor the service has to know about the
          // other's representation.
          { userId, purpose: toProtoOtpPurpose(purpose) },
          metadata,
        ),
      origin,
    );
  }
}

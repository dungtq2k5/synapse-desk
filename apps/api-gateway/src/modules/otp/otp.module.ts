import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpController } from './otp.controller';
import { OtpGrpcClient } from './otp-grpc.client';

/**
 * Imports AuthModule for the gRPC client provider (AUTH_GRPC_CLIENT) and
 * JwtAuthGuard — OTP shares auth-service's connection rather than opening a
 * second one to the same peer.
 */
@Module({
  imports: [AuthModule],
  controllers: [OtpController],
  providers: [OtpGrpcClient],
})
export class OtpModule {}

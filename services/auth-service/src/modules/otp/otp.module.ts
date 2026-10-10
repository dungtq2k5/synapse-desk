import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OtpService } from './otp.service';
import { OtpGrpcController } from './otp-grpc.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OtpGrpcController],
  providers: [OtpService],
  // Exported so AuthService can dispatch the first verification code as part of
  // registration rather than making the user go looking for a button.
  exports: [OtpService],
})
export class OtpModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGrpcClient } from './notifications-grpc.client';
import { NotificationsController } from './notifications.controller';

/**
 * `NOTIFICATION_GRPC_CLIENT` needs no import: `NotificationGrpcModule` is
 * `@Global`, like every other peer's channel.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsGrpcClient],
  exports: [NotificationsGrpcClient],
})
export class NotificationsModule {}

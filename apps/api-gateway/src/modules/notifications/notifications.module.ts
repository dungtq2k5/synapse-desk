import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGrpcClient } from './notifications-grpc.client';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsResolver } from './notifications.resolver';

/**
 * `NOTIFICATION_GRPC_CLIENT` needs no import: `NotificationGrpcModule` is
 * `@Global`, like every other peer's channel.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsGrpcClient,
    NotificationsService,
    NotificationsResolver,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

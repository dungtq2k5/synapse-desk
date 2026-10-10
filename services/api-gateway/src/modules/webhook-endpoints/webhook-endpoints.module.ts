import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsGrpcClient } from './webhook-endpoints-grpc.client';
import { WebhookEndpointsService } from './webhook-endpoints.service';

/**
 * Outbound webhook management.
 *
 * Its own module beside `NotificationsModule` rather than inside it, mirroring
 * the split on the far end: notifications are a person's feed and settings,
 * this is TENANT configuration behind `organization.*` permissions.
 *
 * `NOTIFICATION_GRPC_CLIENT` needs no import: `NotificationGrpcModule` is
 * `@Global`, like every other peer's channel.
 */
@Module({
  imports: [AuthModule],
  controllers: [WebhookEndpointsController],
  providers: [WebhookEndpointsGrpcClient, WebhookEndpointsService],
})
export class WebhookEndpointsModule {}

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WEBHOOK_QUEUE } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhookAdminService } from './webhook-admin.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookRetentionJob } from './webhook-retention.job';
import { WebhookSenderService } from './webhook-sender.service';

/**
 * Outbound webhooks — the tenant-level channel.
 *
 * `BullModule.forRootAsync` lives here rather than in `AppModule` for the
 * reason ingestion-service records: this service had no queue at all before
 * this feature, the delivery queue is its primary one, and the scheduler
 * module registers its own queue on the same connection.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
        },
      }),
    }),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
    PrismaModule,
  ],
  providers: [
    WebhookSenderService,
    WebhookDispatchService,
    WebhookDeliveryProcessor,
    WebhookAdminService,
    WebhookRetentionJob,
  ],
  exports: [WebhookDispatchService, WebhookAdminService, WebhookRetentionJob],
})
export class WebhooksModule {}

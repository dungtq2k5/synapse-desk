import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SCHEDULER_QUEUE } from '@synapsedesk/common';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SchedulerProcessor } from './scheduler.processor';
import { SchedulerRegistrar } from './scheduler.registrar';

/**
 * The fourth scheduler, on the shape the other three share.
 *
 * `BullModule.forRootAsync` is NOT here — `WebhooksModule` registers it,
 * because the delivery queue is this service's primary queue and that is where
 * ingestion-service puts its root too. This module only registers its own
 * queue on that connection.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULER_QUEUE.notification }),
    JobRunsModule,
    WebhooksModule,
  ],
  providers: [SchedulerProcessor, SchedulerRegistrar],
})
export class SchedulerModule {}

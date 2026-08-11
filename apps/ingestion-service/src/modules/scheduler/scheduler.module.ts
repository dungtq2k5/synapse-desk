import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SCHEDULER_QUEUE } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiAnalyticsModule } from '../analytics/analytics.module';
import { ScheduledModule } from '../scheduled/scheduled.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { SchedulerProcessor } from './scheduler.processor';
import { SchedulerRegistrar } from './scheduler.registrar';

/**
 * **The layer whose absence was the whole of 20-doc.**
 *
 * Six jobs in this service existed, were exported, were imported into
 * `AppModule` — and were invoked by nothing. A plain method with no caller is
 * indistinguishable from a finished job in review, and its absence produces
 * zeros rather than errors. Nothing failed; nothing alerted.
 *
 * **BullMQ rather than `@nestjs/schedule`, because of replicas.** `@Cron` runs
 * in-process: three pods fire it three times, and under a rolling deploy zero
 * or four. These jobs are idempotent so nothing corrupts — which is precisely
 * why the duplication would never have been noticed. A repeat entry is
 * scheduled once in Redis and consumed by one worker.
 *
 * `BullModule.forRoot` is NOT registered here: `IngestionModule` already owns
 * it for this service, and a second root would open a second Redis connection
 * with its own configuration to drift.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULER_QUEUE.ingestion }),
    PrismaModule,
    JobRunsModule,
    // Where the jobs live. This module supplies only the clock.
    ScheduledModule,
    AiAnalyticsModule,
  ],
  providers: [SchedulerProcessor, SchedulerRegistrar],
})
export class SchedulerModule {}

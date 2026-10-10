import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SCHEDULER_QUEUE } from '@synapsedesk/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { SchedulerProcessor } from './scheduler.processor';
import { SchedulerRegistrar } from './scheduler.registrar';

/**
 * The clock for `TicketRollupJob`.
 *
 * Without it the rollup tables were never written and all six analytics
 * endpoints answered zero, correctly, from empty tables.
 *
 * `BullModule.forRoot` is NOT registered here — `AnalyticsModule` already owns
 * it for this service, and a second root would open a second Redis connection
 * with its own configuration to drift.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULER_QUEUE.ticket }),
    // Where the job lives. This module supplies only the clock.
    AnalyticsModule,
    PrismaModule,
    JobRunsModule,
  ],
  providers: [SchedulerProcessor, SchedulerRegistrar],
})
export class SchedulerModule {}

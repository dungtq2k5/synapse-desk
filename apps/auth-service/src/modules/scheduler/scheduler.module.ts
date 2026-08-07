import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SCHEDULER_QUEUE } from '@synapsedesk/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExpiredRecordsPruner } from '../sessions/expired-records.job';
import { SchedulerProcessor } from './scheduler.processor';
import { SchedulerRegistrar } from './scheduler.registrar';

/**
 * auth-service's scheduler — 20-doc §3.2.
 *
 * **Replaces `@nestjs/schedule`, which this service was the last user of.** Two
 * `@Cron` jobs fired once per pod; both were idempotent deletes, so the impact
 * was duplicated work rather than wrong data. The reason to change was that a
 * codebase with two scheduling mechanisms grows a third — whoever adds the next
 * job copies whichever they find first.
 *
 * `BullModule.forRootAsync` IS registered here, unlike in ticket-service and
 * ingestion-service: this service had no queue at all before, so there is no
 * existing root to share.
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
    BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
    PrismaModule,
    JobRunsModule,
    InvitationsModule,
  ],
  providers: [ExpiredRecordsPruner, SchedulerProcessor, SchedulerRegistrar],
  exports: [ExpiredRecordsPruner],
})
export class SchedulerModule {}

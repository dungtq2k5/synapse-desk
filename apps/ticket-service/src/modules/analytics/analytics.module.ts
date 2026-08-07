import { Module } from '@nestjs/common';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ANALYTICS_EXPORT_QUEUE } from '@synapsedesk/common';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { TicketRollupJob } from './ticket-rollup.job';
import { AnalyticsService } from './analytics.service';
import { AnalyticsGrpcController } from './analytics-grpc.controller';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsExportFacade } from './analytics-export.facade';
import { AnalyticsExportProcessor } from './analytics-export.processor';

/**
 * The read projection over Domain B — 19-doc.
 *
 * **No `analytics-service` exists**, and that is the decision this module
 * records: a service with no tables either reads another service's database
 * (breaking the boundary every other decision depends on, and doing it as an
 * UNDECLARED dependency) or ETLs into its own store (a real project, not a way
 * to serve eleven endpoints). Analytics lives beside the data it reads, and the
 * gateway composes.
 *
 * **`BullModule.forRootAsync` is here rather than in `AppModule`.** This is the
 * only module in ticket-service that queues anything — the export was its first
 * queue — and registering globally would put a Redis connection in every
 * process that imports the app, including the test bootstraps that never
 * export.
 *
 * `AuthClientModule` is imported for one thing: the tenant's TIMEZONE, which
 * decides which day a figure lands on.
 */
@Module({
  imports: [
    JobRunsModule,
    AuthClientModule,
    StorageClientModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
          db: configService.get<number>('REDIS_DB') ?? 0,
        },
      }),
    }),
    BullModule.registerQueue({ name: ANALYTICS_EXPORT_QUEUE }),
  ],
  controllers: [AnalyticsGrpcController],
  providers: [
    TicketRollupJob,
    AnalyticsService,
    AnalyticsExportService,
    AnalyticsExportFacade,
    AnalyticsExportProcessor,
  ],
  exports: [TicketRollupJob, AnalyticsService, AnalyticsExportService],
})
export class AnalyticsModule {}

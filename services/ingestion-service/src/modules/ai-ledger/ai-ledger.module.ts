import { Module } from '@nestjs/common';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaModule } from '../prisma/prisma.module';
import { AiAnalyticsModule } from '../analytics/analytics.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { AiLedgerService } from './ai-ledger.service';
import { AiLedgerGrpcController } from './ai-ledger-grpc.controller';
import { QuotaAlertService } from './quota-alert.service';
import { QUOTA_REDIS, QuotaCounterService } from './quota-counter.service';

/**
 * The metering layer, built BEFORE anything spends.
 *
 * That ordering is the whole point of putting this at build-order step 2:
 * retrofitting metering across every call site later is far worse than one
 * interface now, and the absence of metering is invisible until a bill arrives.
 */
@Module({
  controllers: [AiLedgerGrpcController],
  // `AiAnalyticsModule` for the three analytics RPCs and the rollup that feeds
  // them — they hang off this controller because they read this
  // module's projection.
  imports: [JobRunsModule, PrismaModule, AuthClientModule, AiAnalyticsModule],
  providers: [
    AiLedgerService,
    QuotaCounterService,
    QuotaAlertService,
    {
      provide: QUOTA_REDIS,
      useFactory: (configService: ConfigService) =>
        new Redis(configService.getOrThrow<string>('REDIS_URL'), {
          db: configService.get<number>('REDIS_DB') ?? 0,
          // Two retries, then fail. The gate FAILS CLOSED on an error, so a
          // long retry budget would turn a Redis blip into a slow request
          // rather than a fast refusal — and a fast refusal is the better
          // failure when the alternative is holding an AI request open.
          maxRetriesPerRequest: 2,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [AiLedgerService, QuotaCounterService, QUOTA_REDIS],
})
export class AiLedgerModule {}

import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { BillingSnapshotJob } from './billing-snapshot.job';
import { BillingSnapshotStore, FINANCE_REDIS } from './billing-snapshot.store';
import { FinanceService } from './finance.service';

/**
 * The platform finance surface.
 *
 * Its own module rather than more methods on `PlatformService`: three of its
 * four sections are local queries with one failure domain and the fourth reads
 * a snapshot with another, which is the same split the two RPCs make.
 *
 * `BillingModule` is imported for `StripeService` alone — the snapshot job is
 * the only thing here that knows Stripe exists.
 */
@Module({
  imports: [PrismaModule, BillingModule],
  providers: [
    FinanceService,
    BillingSnapshotStore,
    BillingSnapshotJob,
    {
      provide: FINANCE_REDIS,
      useFactory: (configService: ConfigService) =>
        new Redis(configService.getOrThrow<string>('REDIS_URL'), {
          // The same logical database as the rest of this service's keys, for
          // the reason `LIMIT_ALERT_REDIS` states: omitting it lands on db 0,
          // which happens to be where auth lands today and would stop being so
          // the day somebody sets `REDIS_DB`.
          db: configService.get<number>('REDIS_DB') ?? 0,
          // The reader degrades on failure and the writer runs hourly, so a
          // long retry budget buys nothing and delays both.
          maxRetriesPerRequest: 2,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [FinanceService, BillingSnapshotJob, BillingSnapshotStore],
})
export class FinanceModule implements OnModuleDestroy {
  constructor(@Inject(FINANCE_REDIS) private readonly redis: Redis) {}

  /**
   * The connection this module OPENED is the connection it closes.
   *
   * A `useFactory` that news up a client gives Nest nothing to shut down, and
   * the socket then outlives `app.close()` — in a test run that means the
   * process never exits.
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

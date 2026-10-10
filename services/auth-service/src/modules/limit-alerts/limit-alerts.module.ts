import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { JetStreamPublisher, LimitAlertPublisher } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthGenerationStore } from './generation.store';

/** The Redis this service's alarm LEVELS live in. */
export const LIMIT_ALERT_REDIS = Symbol('AUTH_LIMIT_ALERT_REDIS');

/** The level alarm for seats — the one dimension auth counts. */
@Module({
  imports: [PrismaModule],
  providers: [
    AuthGenerationStore,
    {
      provide: LIMIT_ALERT_REDIS,
      useFactory: (configService: ConfigService) =>
        new Redis(configService.getOrThrow<string>('REDIS_URL'), {
          // **The SAME logical database the rest of this service's keys live
          // in.** Omitting it lands on db 0, which happens to be where auth
          // also lands under the current config — so the alarm worked, and
          // would have stopped working the day somebody set `REDIS_DB`, with
          // the symptom being alerts that re-fire forever because the level
          // was written to a database nothing reads.
          db: configService.get<number>('REDIS_DB') ?? 0,
          // Two retries, then fail. `evaluate` swallows its own errors, so a
          // long retry budget only delays the enforcement path that called it.
          maxRetriesPerRequest: 2,
        }),
      inject: [ConfigService],
    },
    {
      provide: LimitAlertPublisher,
      useFactory: (
        redis: Redis,
        generations: AuthGenerationStore,
        jetstream: JetStreamPublisher,
      ) => new LimitAlertPublisher(redis, generations, jetstream),
      inject: [LIMIT_ALERT_REDIS, AuthGenerationStore, JetStreamPublisher],
    },
  ],
  exports: [LimitAlertPublisher, AuthGenerationStore, LIMIT_ALERT_REDIS],
})
export class LimitAlertsModule implements OnModuleDestroy {
  constructor(@Inject(LIMIT_ALERT_REDIS) private readonly redis: Redis) {}

  /**
   * The connection this module OPENED is the connection it closes.
   *
   * A `useFactory` that news up a client gives Nest nothing to shut down — the
   * socket outlives `app.close()`, which in a test run means the process never
   * exits and in production means a rolling restart leaves connections behind.
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

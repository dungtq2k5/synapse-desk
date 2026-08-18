import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * The gateway's shared Redis connection.
 *
 * A class rather than a `useFactory` provider, because Nest calls lifecycle
 * hooks only on providers it instantiated from a class — see conventions §2.1. Without it
 * the client is never closed on `app.close()`: one leaked connection per
 * restart, and a test run that passes and then hangs with nothing pointing at
 * the cause.
 *
 * Errors are logged, never thrown. Every consumer degrades rather than fails.
 *
 * The instance runs `maxmemory-policy noeviction`, and three other sites keep
 * their own connection on purpose — see
 * `docs/decisions/0033-redis-noeviction.md`.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /**
   * The connection, shared.
   *
   * Exposed rather than wrapped: consumers issue genuinely different commands —
   * `setex` and `scan` for the cache, sorted sets for presence, `get` for org
   * status — and a wrapper would either re-export half of ioredis or grow a
   * method per caller. What is centralized here is the CONNECTION and its
   * lifecycle, which is what was actually duplicated.
   */
  readonly client: Redis;

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      // Bounded rather than infinite: a hung Redis must surface as an error the
      // caller can decide about, not as a request that never returns.
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (error: Error) =>
      this.logger.error(`Redis client error: ${formatErrorMsg(error)}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    // `.catch()` because a quit against an already-broken connection rejects,
    // and a shutdown path that throws turns a clean stop into a crash — after
    // the work is done and with nothing left to save.
    await this.client.quit().catch(() => undefined);
  }
}

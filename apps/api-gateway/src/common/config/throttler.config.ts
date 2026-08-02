import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AUTH_THROTTLER_TIER } from './app.config';

/**
 * Multi-tier throttler configuration.
 *
 * FOUR named tiers, and the names matter because `SmartThrottlerGuard` routes
 * by them: `short`/`medium`/`long` are the general backstop, `authTier` is the
 * strict one that only `@AuthThrottle()` routes see. A route never evaluates
 * both sets — see the guard for why that is the whole point.
 *
 * **Storage is Redis, not the default in-memory map.** With the default, each
 * replica keeps its own counters, so a 5-per-15-minutes login limit becomes
 * 5 × N and the protection quietly scales away with the deployment. Redis makes
 * the limit a property of the SYSTEM rather than of one process.
 *
 * There is deliberately no `skipIf` for development. Disabling the guard
 * outside production would mean its tier-routing logic — the part most likely
 * to be wrong — is first exercised in production. Development instead runs the
 * SAME code path with looser numbers, which come from env so a test can tighten
 * them.
 */
export const getThrottlerConfig = (
  configService: ConfigService,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'short',
      ttl: configService.getOrThrow<number>('THROTTLER_SHORT_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_SHORT_LIMIT'),
    },
    {
      name: 'medium',
      ttl: configService.getOrThrow<number>('THROTTLER_MEDIUM_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_MEDIUM_LIMIT'),
    },
    {
      name: 'long',
      ttl: configService.getOrThrow<number>('THROTTLER_LONG_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_LONG_LIMIT'),
    },
    {
      name: AUTH_THROTTLER_TIER,
      ttl: configService.getOrThrow<number>('THROTTLER_AUTH_TTL'),
      limit: configService.getOrThrow<number>('THROTTLER_AUTH_LIMIT'),
    },
  ],
  storage: new ThrottlerStorageRedisService(
    new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      // Bounded rather than infinite: a hung Redis must surface as an error the
      // guard can decide about, not as a request that never returns.
      maxRetriesPerRequest: 3,
    }),
  ),
});

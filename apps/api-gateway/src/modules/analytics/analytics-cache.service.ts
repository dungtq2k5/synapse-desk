import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { compareAlphabetically, formatErrorMsg } from '@synapsedesk/common';

/**
 * A range including TODAY changes constantly — today's rollup is provisional
 * until its conversations close.
 */
const OPEN_RANGE_TTL_SECONDS = 60;

/**
 * A CLOSED historical range cannot change except by a backfill, and the
 * `computedAt` in the key catches that. So this can be long.
 */
const CLOSED_RANGE_TTL_SECONDS = 24 * 60 * 60;

const CACHE_PREFIX = 'analytics:';

/** What the key is built from. */
export type CacheKeyInput = {
  organizationId: string;
  endpoint: string;
  /** Every query parameter that changes the answer. Order-insensitive. */
  params: Record<string, unknown>;
  /**
   * The newest rollup run behind the last answer, for a CLOSED range.
   *
   * **This is what makes a backfill invalidate automatically** (19-doc §4).
   * Without it, correcting last quarter's numbers would serve the known-wrong
   * ones for another day — from a cache that is doing exactly what it was told.
   */
  computedAt?: Date | null;
};

/**
 * The analytics cache — 19-doc §4.
 *
 * Read-only, tolerant of staleness, and expensive to compute: the ideal cache
 * case, and the three decisions below are where the wins and the bugs are.
 *
 * **Keyed on `(organizationId, endpoint, params)`, never on the raw URL.**
 * `?from=A&to=B` and `?to=B&from=A` are the same query and must be the same
 * entry — a URL key halves the hit rate for free and does it invisibly.
 *
 * **TTL by range, not one global value.** Today's data changes constantly; last
 * quarter's cannot change at all. This is where most of the win is.
 *
 * **No invalidation on ticket writes.** Analytics is defined over daily rollups
 * that only change when the job runs, so wiring invalidation into the hot path
 * would add cache churn to every ticket create and buy nothing a TTL does not.
 */
@Injectable()
export class AnalyticsCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsCacheService.name);
  private readonly redis: Redis;

  constructor(configService: ConfigService) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 3,
    });
  }

  /**
   * The cache key.
   *
   * **The tenant id is the FIRST segment**, so a cross-tenant hit is not merely
   * unlikely but unreachable: two tenants asking the identical question produce
   * different keys before any parameter is considered. The worst possible cache
   * bug in a multi-tenant system, and the cheapest to prevent.
   *
   * Parameters are SORTED, so ordering cannot produce two entries for one
   * question. `undefined` and `null` are dropped rather than serialised, so an
   * absent optional filter and one explicitly set to nothing agree.
   */
  buildKey(input: CacheKeyInput): string {
    const params = Object.entries(input.params)
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      )
      .map(([key, value]) => `${key}=${String(value)}`)
      .sort(compareAlphabetically);

    // The freshness segment. Present only for closed ranges — for an open
    // range the short TTL is the freshness mechanism, and including a
    // constantly-moving timestamp would make every request a miss.
    const freshness = input.computedAt ? `|@${input.computedAt.getTime()}` : '';

    return `${CACHE_PREFIX}${input.organizationId}|${input.endpoint}|${params.join('&')}${freshness}`;
  }

  /**
   * How long to keep an answer, from whether the range is CLOSED.
   *
   * A range is closed when its end is strictly before today: nothing can change
   * it except a backfill, which the `computedAt` segment catches. Comparison is
   * on the date string rather than on instants, because the range is expressed
   * in the tenant's local days and an instant comparison would flip an hour
   * early or late depending on the server's zone.
   */
  ttlSecondsFor(to: string, today: string = todayIso()): number {
    return to < today ? CLOSED_RANGE_TTL_SECONDS : OPEN_RANGE_TTL_SECONDS;
  }

  /**
   * Read-through.
   *
   * **A Redis failure serves the answer, uncached.** The alternative — failing
   * the request — would mean a cache outage takes down every dashboard in the
   * product, which is a worse day than a slow one. Logged so a persistent
   * failure is visible rather than merely expensive.
   */
  async wrap<T>(
    input: CacheKeyInput,
    ttlSeconds: number,
    produce: () => Promise<T>,
  ): Promise<T> {
    const key = this.buildKey(input);

    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.warn(`Analytics cache read failed: ${formatErrorMsg(error)}`);
    }

    const value = await produce();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `Analytics cache write failed: ${formatErrorMsg(error)}`,
      );
    }

    return value;
  }

  /**
   * Drops every entry for a tenant.
   *
   * The blunt instrument, for a backfill that changed numbers a cached closed
   * range would otherwise keep serving. `computedAt` in the key already handles
   * that automatically — this exists for the case where an operator knows
   * something the key cannot express, and it is deliberately tenant-scoped
   * rather than global.
   */
  async invalidateTenant(organizationId: string): Promise<number> {
    const pattern = `${CACHE_PREFIX}${organizationId}|*`;
    let removed = 0;

    try {
      // SCAN rather than KEYS: `KEYS` blocks the server for the length of the
      // keyspace, and this runs against a Redis that is also serving the
      // throttler and the socket adapter.
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200,
        );
        cursor = next;

        if (keys.length > 0) {
          removed += await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error(
        `Could not invalidate analytics cache for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }

    return removed;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

/** Today, as `YYYY-MM-DD`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

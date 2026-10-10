import { Injectable } from '@nestjs/common';
import { toIsoDay } from '@synapsedesk/common';
import { CacheService } from '../../common/cache/cache.service';

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

/**
 * The scope every analytics entry nests under.
 *
 * `analytics:overview`, `analytics:agents`, … so `invalidateTenant` can drop
 * all of them with one scope and reach nothing else — see
 * `CacheService.invalidateScope`.
 */
const CACHE_SCOPE = 'analytics';

/** What the key is built from. */
export type CacheKeyInput = {
  organizationId: string;
  endpoint: string;
  /** Every query parameter that changes the answer. Order-insensitive. */
  params: Record<string, unknown>;
  /**
   * The newest rollup run behind the last answer, for a CLOSED range.
   *
   * **This is what makes a backfill invalidate automatically**.
   * Without it, correcting last quarter's numbers would serve the known-wrong
   * ones for another day — from a cache that is doing exactly what it was told.
   */
  computedAt?: Date | null;
};

/**
 * The analytics cache.
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
export class AnalyticsCacheService {
  constructor(private readonly cache: CacheService) {}

  /**
   * The key, delegated.
   *
   * **What stayed here is what is genuinely analytics**: the endpoint-to-scope
   * mapping and the `computedAt` freshness segment. The tenant-first ordering,
   * the sorted parameters and the absent/empty collapse are properties every
   * cached read in the gateway needs, and they now live in one place instead of
   * being re-derived by the second caller who needs them.
   */
  buildKey(input: CacheKeyInput): string {
    return this.cache.buildKey(this.toCacheKey(input));
  }

  /**
   * How long to keep an answer, from whether the range is CLOSED.
   *
   * **This is the analytics-specific half and it stays.** A range is closed when
   * its end is strictly before today: nothing can change it except a backfill,
   * which the `computedAt` segment catches. Comparison is on the date string
   * rather than on instants, because the range is expressed in the tenant's
   * local days and an instant comparison would flip an hour early or late
   * depending on the server's zone.
   */
  ttlSecondsFor(to: string, today: string = toIsoDay(new Date())): number {
    return to < today ? CLOSED_RANGE_TTL_SECONDS : OPEN_RANGE_TTL_SECONDS;
  }

  /**
   * Read-through.
   *
   * A Redis failure serves the answer uncached — `CacheService` fails open, and
   * the alternative would mean a cache outage takes down every dashboard in the
   * product rather than merely slowing them.
   */
  wrap<T>(
    input: CacheKeyInput,
    ttlSeconds: number,
    produce: () => Promise<T>,
  ): Promise<T> {
    return this.cache.wrap(this.toCacheKey(input), ttlSeconds, produce);
  }

  /**
   * Drops every analytics entry for a tenant.
   *
   * The blunt instrument, for a backfill that changed numbers a cached closed
   * range would otherwise keep serving. `computedAt` in the key already handles
   * that automatically — this exists for the case where an operator knows
   * something the key cannot express.
   *
   * **Scoped to `analytics`, not to the tenant's whole cache.** Under the shared
   * prefix a tenant-wide wipe would now also drop the roles, departments and
   * organization entries, which this operation never meant and whose reads
   * would then all miss at once.
   */
  invalidateTenant(organizationId: string): Promise<number> {
    return this.cache.invalidateScope(organizationId, CACHE_SCOPE);
  }

  /** `{ endpoint, computedAt }` in analytics terms → a generic cache key. */
  private toCacheKey(input: CacheKeyInput) {
    return {
      organizationId: input.organizationId,
      scope: `${CACHE_SCOPE}:${input.endpoint}`,
      params: input.params,
      // Present only for closed ranges — for an open range the short TTL is the
      // freshness mechanism, and including a constantly-moving timestamp would
      // make every request a miss.
      version: input.computedAt ? input.computedAt.getTime() : undefined,
    };
  }
}

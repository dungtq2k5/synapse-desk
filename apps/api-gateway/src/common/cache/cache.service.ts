import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { compareAlphabetically, formatErrorMsg } from '@synapsedesk/common';
import { RedisService } from '../redis/redis.service';

/**
 * Every key this service writes begins here, so one `SCAN` can find them all
 * and nothing else in the shared Redis can be caught by one.
 *
 * That last half matters: this instance also holds the throttler's counters,
 * the socket adapter's channels and BullMQ's queues. A pattern that reached
 * outside this prefix would let a cache invalidation delete a rate-limit
 * counter or a queued job.
 */
const CACHE_PREFIX = 'cache:';

/**
 * The tenant segment for a read that genuinely has no tenant.
 *
 * A platform Super Admin has `organizationId: null` (RDM). Rendering that as an
 * empty segment would make every tenantless read collide under `cache:|…`, so
 * it gets a name instead.
 *
 * **A read whose ANSWER depends on a tenant must never arrive here with null.**
 * The literal is for questions with no tenant dimension, not for a caller who
 * happens not to have looked one up.
 */
const NO_TENANT = 'no-tenant';

/** What a key is built from */
export type CacheKeyInput = {
  /**
   * **The FIRST segment, always**
   *
   * Two tenants asking the identical question produce different keys before any
   * parameter is considered, so a cross-tenant hit is unreachable rather than
   * merely unlikely. It is the worst bug available in a multi-tenant cache and
   * the cheapest one to make impossible.
   */
  organizationId: string | null;
  /**
   * What is being cached: `roles`, `departments`, `analytics:overview`.
   *
   * `:` nests. `invalidateScope(org, 'analytics')` drops `analytics:overview`
   * and `analytics:agents` and nothing else — see {@link scopePattern}.
   */
  scope: string;
  /** Everything that changes the answer. Order-insensitive. */
  params?: Record<string, unknown>;
  /**
   * An optional freshness discriminator — a rollup's `computedAt`, a document's
   * `updatedAt`.
   *
   * Where it applies it is strictly better than a short TTL: the old entry is
   * not evicted, it simply stops being addressed, so a backfill invalidates
   * automatically and nothing has to notice.
   */
  version?: string | number;
};

/**
 * The shared cache
 *
 * Generalized from `AnalyticsCacheService`, which had the design right and only
 * lacked reach: tenant-first keys, sorted parameters, `wrap()` as the single
 * read path, and `SCAN`-based invalidation. Analytics keeps the parts that are
 * genuinely analytics — its range-derived TTL and its `computedAt` segment —
 * and calls this for the rest.
 *
 * **Not `@nestjs/cache-manager`, and the reason is specific rather than a
 * preference.** `CacheModule` brings `CacheInterceptor`, whose default key is
 * the request URL — which contains no tenant. `GET /roles` would be ONE key for
 * every tenant on the platform, so the second tenant to ask receives the
 * first's roles, with no error and no trace. It can be subclassed to override
 * `trackBy`, and at that point `cache-manager` is supplying a `get`/`set`
 * wrapper over a Redis client this gateway already has. **The abstraction is
 * not earning the risk of its default.**
 *
 * **A cache fails OPEN.** Every Redis error here is logged and swallowed: a
 * cache outage must make the product slow, not down. That is the exact opposite
 * of the throttler next door, which fails closed because an unmetered surface
 * is worse than a refused request — worth stating because the two sit beside
 * each other and the asymmetry is deliberate.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  constructor(redis: RedisService) {
    this.redis = redis.client;
  }

  /**
   * The key.
   *
   * Parameters are SORTED, so `?from=A&to=B` and `?to=B&from=A` are one entry
   * rather than two. Halving a hit rate invisibly is the mild version of that
   * bug; the severe version is an invalidation that clears one spelling and
   * leaves the other serving stale data forever.
   *
   * `undefined`, `null` and `''` are DROPPED rather than serialised, so "filter
   * not supplied" and "filter set to nothing" agree — they are the same
   * question and a client that omits a field and one that sends an empty string
   * must not split the cache between them.
   */
  buildKey(input: CacheKeyInput): string {
    const params = Object.entries(input.params ?? {})
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      )
      .map(([key, value]) => `${key}=${stringifyParam(value)}`)
      .sort(compareAlphabetically);

    const version =
      input.version === undefined || input.version === null
        ? ''
        : `|@${String(input.version)}`;

    return `${CACHE_PREFIX}${input.organizationId ?? NO_TENANT}|${input.scope}|${params.join('&')}${version}`;
  }

  /**
   * Read-through, and **the only read path**.
   *
   * A hand-rolled `get`-then-`set` at a call site is where a key gets built a
   * second, slightly different way — and the two spellings then diverge, with
   * an invalidation clearing one of them.
   *
   * **`produce()` throwing is not cached.** Caching a failure turns one bad
   * response into a minute of them, and does it precisely when the origin is
   * already in trouble.
   *
   * ---
   *
   * **The read-repopulate race, which is accepted rather than fixed.**
   * Written down because the symptom is indistinguishable from a real bug,
   * and somebody will otherwise spend a day on it.
   *
   * ```txt
   * reader:  get (miss) ── produce() ────────────── set(stale)
   * writer:                    └─ invalidate() ──┘
   * ```
   *
   * An invalidation landing between `produce()` and `set` is overwritten by the
   * value that was already in flight, and that pre-write value then lives for
   * its full TTL. The window is one gRPC round trip — tens of milliseconds —
   * and it needs a mutation to land inside it.
   *
   * **Not fixed on purpose.** Double-delete, versioned keys and a distributed
   * lock each add a failure mode larger than the one they close: a lock adds an
   * outage path to a component whose entire contract is failing open. The worst
   * case here is one entry stale for one TTL.
   *
   * What keeps it a narrow window rather than the common case is that
   * `CacheInvalidationInterceptor` evicts AFTER the handler resolves
   * (`concatMap`, asserted in `cache-invalidation.spec.ts`). Evicting before
   * the write would make the interleaving above the normal ordering rather than
   * a race.
   */
  async wrap<T>(
    input: CacheKeyInput,
    ttlSeconds: number,
    produce: () => Promise<T>,
  ): Promise<T> {
    const key = this.buildKey(input);

    try {
      const cached = await this.redis.get(key);
      // `!== null` rather than a truthiness check: a cached `null` is a real
      // answer — "this id resolves to nothing" is worth remembering, and it
      // arrives from Redis as the string `"null"`.
      if (cached !== null) return decode<T>(cached);
    } catch (error) {
      this.logger.warn(
        `Cache read failed for ${key}: ${formatErrorMsg(error)}`,
      );
    }

    // OUTSIDE the try. A throw here is the origin failing, and it must reach
    // the caller as itself rather than being caught by a cache's error
    // handling and reported as a cache problem.
    const value = await produce();

    try {
      // `undefined` has no JSON representation — `JSON.stringify` returns
      // `undefined`, not a string — so writing it would store the literal text
      // "undefined" and throw on the next parse.
      if (value !== undefined) {
        await this.redis.set(key, encode(value), 'EX', ttlSeconds);
      }
    } catch (error) {
      this.logger.warn(
        `Cache write failed for ${key}: ${formatErrorMsg(error)}`,
      );
    }

    return value;
  }

  /**
   * Reads many entries at once, for the loaders.
   *
   * **One round trip, not N.** A loader batch already collapsed the RPCs; doing
   * the cache lookups serially would put the N back one layer down, which is
   * the failure the whole DataLoader design exists to avoid.
   *
   * A miss and a cached `null` are BOTH reported as `null` here, and the
   * caller must treat them the same. Distinguishing them would let an entity
   * that resolves to nothing be remembered as nothing — see
   * `createCachedLoader`, which deliberately does not.
   */
  async mget<T>(inputs: CacheKeyInput[]): Promise<(T | null)[]> {
    if (inputs.length === 0) return [];

    try {
      const raw = await this.redis.mget(inputs.map((i) => this.buildKey(i)));

      return raw.map((text) => (text === null ? null : decode<T>(text)));
    } catch (error) {
      this.logger.warn(`Cache mget failed: ${formatErrorMsg(error)}`);

      // Fail OPEN: every key reported as a miss, so the caller fetches
      // everything and the request succeeds slowly rather than not at all.
      return inputs.map(() => null);
    }
  }

  /**
   * Writes many entries with one TTL.
   *
   * A PIPELINE rather than `MSET`, because `MSET` cannot carry an expiry — and
   * an entity cache without a TTL is a permanent copy of a row that changes,
   * which is the failure mode this whole layer is supposed to be the safe
   * alternative to.
   */
  async msetEx<T>(
    entries: { input: CacheKeyInput; value: T }[],
    ttlSeconds: number,
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const { input, value } of entries) {
        if (value === undefined) continue;
        pipeline.set(this.buildKey(input), encode(value), 'EX', ttlSeconds);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger.warn(`Cache msetEx failed: ${formatErrorMsg(error)}`);
    }
  }

  /** Drops one exact entry. The precise half of the invalidation model. */
  async invalidate(input: CacheKeyInput): Promise<void> {
    const key = this.buildKey(input);

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(
        `Cache invalidation failed for ${key}: ${formatErrorMsg(error)}`,
      );
    }
  }

  /**
   * Drops every entry in a scope for one tenant, and returns how many.
   *
   * **`SCAN`, never `KEYS`.** `KEYS` blocks the Redis server for the length of
   * the whole keyspace, and this instance is also serving the throttler, the
   * socket adapter and BullMQ — so the blunt version of a cache invalidation
   * would stall rate limiting and real-time delivery for every tenant on the
   * platform.
   *
   * Tenant-scoped by construction: the pattern starts with the tenant segment,
   * so one tenant's invalidation cannot reach another's entries even if the
   * scope is wrong.
   */
  async invalidateScope(
    organizationId: string | null,
    scope: string,
  ): Promise<number> {
    const pattern = scopePattern(organizationId, scope);
    let removed = 0;

    try {
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

        if (keys.length > 0) removed += await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error(
        `Cache scope invalidation failed for ${pattern}: ${formatErrorMsg(error)}`,
      );
    }

    return removed;
  }
}

/**
 * The tag a `Date` is stored under — see {@link encode}.
 *
 * Deliberately unlikely to occur in real data: an object that happened to carry
 * this exact single key would be revived as a `Date`, so it is named to make
 * that a non-event rather than merely improbable.
 */
const DATE_TAG = '__cache_date__';

/**
 * JSON, plus `Date` — and the `Date` half is a bug fix, not a nicety.
 *
 * **What plain `JSON.stringify` did here:** a cached `Date` comes back as an
 * ISO *string*, and `GraphQLISODateTime.serialize()` given a string returns
 * **`null`** — it does not throw. So `analyticsOverview { computedAt }`
 * answered the real timestamp on a cache MISS and `null` on a cache HIT.
 *
 * That is not a cosmetic difference. `computedAt: null` has a defined meaning
 * in this system — *the rollups have never run for this tenant* — and it is
 * half of the diagnostic pair defined against `dataThrough`. So the
 * cache made a healthy scheduler report as one that had never started, for the
 * length of a TTL at a time, on a field whose whole purpose is telling an
 * operator whether the scheduler is working.
 *
 * Invisible on REST, where a `Date` and its ISO string serialise identically.
 * Which is why it survived: the surface that shows the bug was built after the
 * cache that causes it.
 *
 * **Tagged rather than guessed.** The tempting fix is a reviver that turns any
 * ISO-looking string back into a `Date`; that converts real strings too — a
 * ticket whose title is a timestamp, a `dataThrough` that is deliberately a
 * `YYYY-MM-DD` string and must stay one.
 *
 * **`BigInt` is not handled, and in the gateway it cannot arrive.**
 * `maxStorageBytes` and `monthlyAiTokenBudget` are `int64` on the wire, and
 * `GRPC_LOADER_OPTIONS` sets `longs: Number`, so the generated types are
 * `number`; the gateway never holds a Prisma row.
 *
 * **It would matter the first time a SERVICE caches**, because there those
 * columns are real `BigInt`s and `JSON.stringify` throws
 * `TypeError: Do not know how to serialize a BigInt`. The throw lands inside
 * `wrap()`'s write `try`, which logs and continues — so the symptom is a
 * permanent silent miss that reads as "caching does not work on this route",
 * with a warning nobody correlates. Add a `BigInt` branch here before moving
 * this file service-side.
 */
function encode(value: unknown): string {
  // A regular function, not an arrow, and that is load-bearing: `JSON.stringify`
  // calls `Date.prototype.toJSON` BEFORE the replacer runs, so `value` here is
  // already a string. `this[key]` is the only way to see the original.
  return JSON.stringify(
    value,
    function (this: Record<string, unknown>, key, replaced: unknown) {
      const original = this[key];

      return original instanceof Date
        ? { [DATE_TAG]: original.toISOString() }
        : replaced;
    },
  );
}

function decode<T>(text: string): T {
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null && DATE_TAG in value) {
      return new Date((value as Record<string, string>)[DATE_TAG]);
    }

    return value;
  }) as T;
}

/**
 * The glob for a scope and everything nested under it.
 *
 * `[|:]` is the whole trick. A scope is followed by `|` when it is the exact
 * one and by `:` when it is a parent, so the character class matches
 * `analytics|…` and `analytics:overview|…` while NOT matching a differently
 * named scope that merely starts with the same letters — `analytics-export`
 * survives an `invalidateScope(org, 'analytics')`, which a bare `analytics*`
 * would have deleted.
 *
 * Safe because a scope is a code constant, never user input: a scope carrying
 * `*` or `[` would widen its own pattern, and nothing here is in a position to.
 */
function scopePattern(organizationId: string | null, scope: string): string {
  return `${CACHE_PREFIX}${organizationId ?? NO_TENANT}|${scope}[|:]*`;
}

/**
 * One parameter value as a STABLE, COLLISION-FREE key segment.
 *
 * **`String(value)` was not enough, and the gap was reachable from a query
 * string.** `CacheableInterceptor` spreads `request.query` into the params, and
 * Express's default (`extended`) parser produces objects and arrays from it:
 * `?f[x]=1` arrives as `{ f: { x: '1' } }`. `String()` renders every one of
 * those as `[object Object]`, so `?f[x]=1` and `?f[y]=2` built the SAME key —
 * and the second caller was served the answer computed for the first's filter.
 *
 * That is the collision `buildKey`'s own docblock warns about, arriving through
 * the one input nobody controls.
 *
 * **Objects are serialized with SORTED keys**, recursively, for the same reason
 * the top-level params are sorted: `{a,b}` and `{b,a}` are the same question and
 * must not split the cache. Plain `JSON.stringify` preserves insertion order and
 * would.
 *
 * **Arrays are bracketed** so `?a=1&a=2` (`['1','2']`) cannot collide with the
 * literal string `'1,2'` — a join alone makes those two indistinguishable.
 *
 * `Date` is ISO rather than `String(date)`, which is locale- and zone-shaped and
 * would key the same instant differently on two machines.
 */
function stringifyParam(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return `[${value.map(stringifyParam).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareAlphabetically(a, b))
      .map(([key, nested]) => `${key}=${stringifyParam(nested)}`)
      .join(',')}}`;
  }

  return String(value);
}

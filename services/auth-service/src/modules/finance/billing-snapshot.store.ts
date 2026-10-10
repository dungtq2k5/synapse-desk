import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  RevenueUnavailableReason,
  SNAPSHOT_TTL_SECONDS,
  formatErrorMsg,
} from '@synapsedesk/common';

/**
 * The Redis the revenue snapshot lives in.
 *
 * **Its own token beside `LIMIT_ALERT_REDIS`**, not a shared generic one: both
 * are purpose-named on purpose, so a `SCAN` for one purpose's keys cannot be
 * pointed at a client that also holds the other's.
 *
 * **Declared in the CONSUMER, and `limit-alerts`' arrangement does not
 * transfer.** `LIMIT_ALERT_REDIS` sits in `limit-alerts.module.ts` because its
 * only decorator-site consumer is the module class in that same file. Here the
 * consumer is this store, a separate file — so putting the token in
 * `finance.module.ts` makes the module import the store and the store import
 * the module back.
 *
 * **That cycle was measured, and it does not fail where you would look.** Under
 * Jest's CommonJS registry the symbol resolves `undefined` at decoration time,
 * `@Inject(undefined)` breaks provider construction, and Nest reports
 * *"The `@grpc/proto-loader` package is missing"* before calling
 * `process.exit(1)` — every auth-service e2e suite down, including ones that
 * touch none of this, pointing at a package that is installed and importable.
 */
export const FINANCE_REDIS = Symbol('AUTH_FINANCE_REDIS');

/** The one key this store writes. */
const SNAPSHOT_KEY = 'finance:revenue-snapshot';

/**
 * What the hourly job leaves behind for the endpoint to read.
 *
 * Discriminated rather than a partial, so "no number, and here is why" is a
 * state the type system knows about instead of a bag of `undefined`s that a
 * consumer has to interpret.
 */
export type RevenueSnapshot =
  | {
      available: true;
      /** Smallest currency unit, as Stripe reports it. Annual prices ÷ 12. */
      estimatedMrr: number;
      /** `null` when there are no active subscriptions to take one from. */
      currency: string | null;
      activeSubscriptions: number;
      /** ISO — when the JOB read Stripe, never when the endpoint answered. */
      computedAt: string;
    }
  | {
      available: false;
      reason: RevenueUnavailableReason;
      computedAt: string;
    };

/**
 * The result of asking the store for a snapshot.
 *
 * **Three facts used to share one `null`**: there is no snapshot, the store
 * could not be reached, and the stored JSON is not a snapshot. Only the first
 * is a statement about the job, and `NO_SNAPSHOT` is a statement about the job
 * — so the other two arrived at the endpoint wearing its label while
 * `/platform/jobs` showed the job green.
 */
export type SnapshotRead =
  | { ok: true; snapshot: RevenueSnapshot }
  | { ok: false; why: RevenueUnavailableReason };

/**
 * A stored value that is actually a snapshot.
 *
 * **Not defensive tidiness — the bare cast had a specific failure.**
 * `JSON.parse(raw) as RevenueSnapshot` will happily produce `{ available: true }`
 * with no `estimatedMrr`, which is exactly what a snapshot written by a previous
 * deploy looks like. Downstream nothing notices: `toFinanceRevenueResponseDto`
 * reads the discriminant and trusts the rest, the gateway mapper's `?? null`
 * fills the hole, and the wire carries `available: true, estimatedMrr: null` —
 * a section claiming a number it does not have, which is worse than the degraded
 * branch this design went to trouble to build.
 *
 * Checks the discriminant and the fields that branch depends on, and nothing
 * else: a wrong `currency` renders wrongly, a missing `estimatedMrr` renders a
 * lie.
 */
function isRevenueSnapshot(value: unknown): value is RevenueSnapshot {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<RevenueSnapshot>;
  if (typeof candidate.computedAt !== 'string') return false;

  return candidate.available === true
    ? typeof (candidate as { estimatedMrr?: unknown }).estimatedMrr ===
        'number' &&
        typeof (candidate as { activeSubscriptions?: unknown })
          .activeSubscriptions === 'number'
    : candidate.available === false &&
        typeof (candidate as { reason?: unknown }).reason === 'string';
}

/**
 * The revenue snapshot, in Redis.
 *
 * **A second purpose-named client, not a reused cache.** `CacheService` is
 * `api-gateway`'s; auth-service has exactly one Redis client and it is
 * `LIMIT_ALERT_REDIS`, provided for the alarm levels and named for them.
 * Reaching for it here would put billing state behind a token whose name says
 * limit alerts, which is the kind of thing that survives until somebody clears
 * "the alert keys" and takes the finance page down with them.
 *
 * **Redis rather than a table, and the trade is explicit.** A row would survive
 * a flush; this does not, and the deliberate flush scenario in
 * `platform.service.ts` would blank the revenue section until the next hourly
 * run. Accepted because the snapshot is a CACHE of a live third-party read —
 * losing it costs an hour of freshness and nothing else, and a table would make
 * a derived Stripe figure look like a record this system keeps, which is the
 * mirror `billing.config.ts` refuses at the top of the file.
 */
@Injectable()
export class BillingSnapshotStore {
  private readonly logger = new Logger(BillingSnapshotStore.name);

  constructor(@Inject(FINANCE_REDIS) private readonly redis: Redis) {}

  /**
   * The stored snapshot, or which of three reasons there is not one.
   *
   * **Never throws**, and that part is unchanged: Redis being unreachable
   * degrades the revenue section rather than failing the whole finance
   * response, of which three of four sections are local and exact.
   *
   * **What changed is that the failures no longer share an answer.** A caller
   * that saw `null` could only report `NO_SNAPSHOT`, which is a claim about the
   * job — made, in the outage case, while the job was running perfectly and
   * `/platform/jobs` said so.
   */
  async read(): Promise<SnapshotRead> {
    let raw: string | null;

    try {
      raw = await this.redis.get(SNAPSHOT_KEY);
    } catch (error) {
      this.logger.warn(
        `Could not reach the revenue snapshot store: ${formatErrorMsg(error)}`,
      );

      return { ok: false, why: RevenueUnavailableReason.SNAPSHOT_UNREADABLE };
    }

    if (!raw) return { ok: false, why: RevenueUnavailableReason.NO_SNAPSHOT };

    // Parse and shape checked together: a `JSON.parse` that throws and one that
    // returns the wrong object are the same fact to the reader — the stored
    // value is not a snapshot — and differ only in the log line.
    try {
      const parsed: unknown = JSON.parse(raw);

      if (!isRevenueSnapshot(parsed)) {
        this.logger.warn(
          'The stored revenue snapshot is not a snapshot — most likely a shape left by a previous deploy',
        );

        return { ok: false, why: RevenueUnavailableReason.SNAPSHOT_UNREADABLE };
      }

      return { ok: true, snapshot: parsed };
    } catch (error) {
      this.logger.warn(
        `Could not parse the revenue snapshot: ${formatErrorMsg(error)}`,
      );

      return { ok: false, why: RevenueUnavailableReason.SNAPSHOT_UNREADABLE };
    }
  }

  /**
   * Stores a snapshot with {@link SNAPSHOT_TTL_SECONDS} of life.
   *
   * The TTL is what makes a dead job visible in the response as well as in
   * `/platform/jobs`: without it a snapshot from three weeks ago would render
   * as a current figure, and `computedAt` is the only thing that would have
   * said otherwise.
   */
  async write(snapshot: RevenueSnapshot): Promise<void> {
    await this.redis.set(
      SNAPSHOT_KEY,
      JSON.stringify(snapshot),
      'EX',
      SNAPSHOT_TTL_SECONDS,
    );
  }

  /** Test seam — the suites that assert the no-snapshot degrade start here. */
  async clear(): Promise<void> {
    await this.redis.del(SNAPSHOT_KEY);
  }
}

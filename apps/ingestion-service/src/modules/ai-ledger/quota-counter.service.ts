import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { formatErrorMsg, quotaCounterKey } from '@synapsedesk/common';

export const QUOTA_REDIS = Symbol('QUOTA_REDIS');

/**
 * The runtime spend counter — RDM §1.14.
 *
 * `SUM(estimated_cost_micros) WHERE organization_id = ? AND created_at >
 * billing_cycle_start` is the DEFINITION of spend and an unacceptable hot-path
 * query: a growing scan on every AI request. This is the fast answer; the
 * ledger is the true one, and a scheduled job reconciles them.
 *
 * Nothing here caches. Every method is one Redis round trip, because the whole
 * reason this exists is that the alternative was a Postgres scan.
 */
@Injectable()
export class QuotaCounterService implements OnModuleDestroy {
  private readonly logger = new Logger(QuotaCounterService.name);

  constructor(@Inject(QUOTA_REDIS) private readonly redis: Redis) {}

  /**
   * `useFactory` providers get no lifecycle hooks, so the class that holds the
   * client owns closing it. Without this the connection survives `app.close()`
   * — a leak per restart in production, and a test run that finishes every
   * assertion and then hangs.
   */
  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * Reads the counter. Throws if Redis is unreachable — FAILS CLOSED.
   *
   * This is the one place a cache miss must not mean "allow". Returning 0 on a
   * connection error would open the gate for every tenant simultaneously, at
   * exactly the moment nobody can see what is being spent. The caller turns
   * this into a refusal.
   */
  async spentMicros(
    organizationId: string,
    billingCycleStart: Date,
  ): Promise<bigint> {
    const raw = await this.redis.get(
      quotaCounterKey(organizationId, billingCycleStart),
    );

    // An absent key is a genuine zero — a new cycle, or a tenant who has not
    // spent yet. Distinct from an unreachable Redis, which throws above.
    return raw ? BigInt(raw) : 0n;
  }

  /**
   * SYNCHRONOUS and awaited by the caller. A single INCRBY, sub-millisecond.
   *
   * On the hot path deliberately: this is the only thing standing between a
   * burst of concurrent requests and all of them passing a stale gate. An
   * asynchronous increment means N requests read the same value, all pass, and
   * all spend — reconciliation then reports the overrun after the money is
   * gone.
   *
   * The TTL is refreshed on every charge rather than set once at creation. A
   * key created at the start of a cycle with a fixed 60-day TTL would expire
   * mid-cycle for a long billing period, silently resetting a tenant's spend to
   * zero — which reads as a generous bug rather than a broken counter.
   */
  async charge(
    organizationId: string,
    billingCycleStart: Date,
    costMicros: bigint,
  ): Promise<bigint> {
    if (costMicros <= 0n)
      return this.spentMicros(organizationId, billingCycleStart);

    const key = quotaCounterKey(organizationId, billingCycleStart);

    const [incremented] = await this.redis
      .multi()
      .incrby(key, Number(costMicros))
      .expire(key, COUNTER_TTL_SECONDS)
      .exec()
      .then((results) => results ?? []);

    return BigInt((incremented?.[1] as number | undefined) ?? 0);
  }

  /**
   * Overwrites the counter with a re-derived total — the reconciliation path.
   *
   * SET, not INCRBY: the job has computed the authoritative sum from the
   * ledger, so adding to whatever drift is already there would compound the
   * error rather than correct it.
   */
  async reconcile(
    organizationId: string,
    billingCycleStart: Date,
    trueSpendMicros: bigint,
  ): Promise<void> {
    await this.redis.set(
      quotaCounterKey(organizationId, billingCycleStart),
      trueSpendMicros.toString(),
      'EX',
      COUNTER_TTL_SECONDS,
    );
  }

  /** Whether Redis is answering at all — used by the gate's fail-closed path. */
  async isReachable(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      this.logger.error(`Quota Redis unreachable: ${formatErrorMsg(error)}`);
      return false;
    }
  }
}

/**
 * 70 days.
 *
 * Comfortably longer than any monthly cycle, so the key cannot expire while it
 * is still the live counter — and short enough that keys for cycles nobody will
 * ever read again do not accumulate forever.
 */
const COUNTER_TTL_SECONDS = 70 * 24 * 60 * 60;

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * The gateway's shared Redis connection — 28-doc §6 step 1, 29-doc §2.
 *
 * **A class, not a `useFactory` provider**, and that is the whole reason this
 * file exists rather than a one-line provider in a module. Conventions §15 gap
 * 11: a `useFactory`-provided value gets **no lifecycle hooks**, so the client
 * is never closed on `app.close()` — one leaked connection per restart in
 * production, and in tests a suite that passes and then hangs with nothing
 * pointing at the cause. `OnModuleDestroy` on an `@Injectable()` is what Nest
 * actually calls.
 *
 * **Errors are logged, never thrown.** Every consumer of this client degrades
 * rather than fails: a cache falls through to its origin, presence reports
 * nobody online, the org-status check fails open. An unhandled `error` event on
 * an ioredis client is an unhandled rejection, which takes the process down —
 * so the listener is not optional decoration.
 *
 * ---
 *
 * **What happens when Redis fills up**, which is the question an outage asks
 * first.
 *
 * The instance runs `maxmemory` with `maxmemory-policy noeviction` (set in
 * `docker-compose.yml`, with the full reasoning beside it). **Writes fail when
 * it fills — all of them, not just the cache's — and that is the deliberate
 * choice rather than the default.**
 *
 * `volatile-ttl` was tried first and is wrong. It orders eviction by nearest
 * expiry, which sounds ideal: cache entries at 60s–1h go before the AI spend
 * counter `quota:{org}:{cycle}` at 70 days, and that ordering is exactly what
 * `allkeys-lru` and `volatile-lru` get dangerously wrong (the counter is cold —
 * written once per generation, read once per gate check — so recency policies
 * discard it and reset a tenant's metered spend mid-cycle).
 *
 * What it missed is that **BullMQ's job locks carry an expiry too, and it is the
 * shortest in the instance**: `SET <job>:lock <token> PX <lockDuration>`, 30s by
 * default. Nearest-expiry-first therefore evicts the LOCKS before any cache
 * entry — and an evicted lock is not a cache miss, it is a job the
 * stalled-checker returns to the queue and a worker runs a second time. Every
 * worker says so at boot: *"IMPORTANT! Eviction policy is volatile-ttl. It
 * should be noeviction"*.
 *
 * **On one shared instance no policy spares both**: cache keys sit between the
 * locks and the counter on every available ordering. `noeviction` is the only
 * setting that cannot silently corrupt something — a failed write is a visible
 * error, a duplicated job is not.
 *
 * **This bounds nothing; it only makes the failure loud.** A second Redis
 * instance for cache keys is the thorough fix and stays deferred (28-doc §7);
 * `maxmemory` is not per-database, so a separate logical DB would be a
 * blast-radius boundary and not a limit.
 *
 * ---
 *
 * **Three sites deliberately keep their own connection**, each for a reason
 * that is already written down where it lives, and `redis-clients.spec.ts`
 * pins the list so a fourth cannot appear quietly:
 *
 *   - **The Socket.IO adapter** holds a pub/sub PAIR. A Redis client in
 *     subscriber mode may issue no other commands, so the subscriber cannot be
 *     this one, and `createAdapter` wants a matched pair whose lifetime is the
 *     adapter's.
 *   - **The throttler** is handed a URL rather than an instance, deliberately:
 *     `ThrottlerStorageRedisService` closes the connection only when it built
 *     it, so passing an instance leaks it past shutdown — which is precisely
 *     the hanging-test failure this class exists to prevent.
 *   - **The health probe** needs the OPPOSITE options: one attempt, a command
 *     timeout, and `enableOfflineQueue: false`. Sharing this client would make
 *     the probe buffer its command through an outage and report UP the moment
 *     Redis came back, having reported nothing at all while it was down. A
 *     probe that shares the connection it is probing is not the goal; a probe
 *     that cannot lie is.
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
   * method per caller. What is centralised here is the CONNECTION and its
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

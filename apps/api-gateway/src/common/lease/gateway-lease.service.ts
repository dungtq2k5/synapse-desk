import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { RedisService } from '../redis/redis.service';

/**
 * Which implementation a process belongs to. One of two, ever.
 *
 * The Java gateway claims under `java`; everything in this repository that
 * runs `main.ts` is `node`. The value is not configurable: it identifies the
 * CODE, not the deployment, and a gateway that could be told it was the other
 * implementation could stand by against itself.
 */
export const GATEWAY_IMPLEMENTATIONS = ['node', 'java'] as const;
export type GatewayImplementation = (typeof GATEWAY_IMPLEMENTATIONS)[number];

/** Where one implementation's live pods are recorded. */
export const holdersKey = (implementation: GatewayImplementation): string =>
  `gateway:holders:${implementation}`;

/** How long an entry outlives its last refresh. */
export const LEASE_TTL_MS = 30_000;

/** How often a holder refreshes, comfortably inside {@link LEASE_TTL_MS}. */
export const LEASE_REFRESH_MS = 10_000;

/**
 * How long a holder may go without a successful refresh before it steps down.
 *
 * **Before the TTL, not at it.** At the TTL another implementation may claim,
 * so a holder that waited for it would still be consuming when the new owner
 * started. Two missed refreshes is the deadline; the gap to the TTL is the
 * bound on an overlap, and a timing bound is enough here: the consequence is
 * duplicate frames, not lost data.
 */
export const LEASE_FENCE_MS = 20_000;

/**
 * Prunes expired entries of BOTH implementations, then adds the caller's own
 * only if the other implementation has no live pod left.
 *
 * One script because the check and the claim have to be one step: two
 * standbys of different implementations running a read-then-write would both
 * see an empty set and both become active. A new replica of the implementation
 * that is already active joins through the same script — the set is per pod,
 * so joining is what the empty-other-set test allows.
 *
 * KEYS[1] mine, KEYS[2] theirs; ARGV[1] now, ARGV[2] expiry, ARGV[3] pod id.
 */
const CLAIM = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
  if redis.call('ZCARD', KEYS[2]) > 0 then return 0 end
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return 1
`;

/**
 * Extends the caller's OWN entry, and only if it is still there.
 *
 * A plain `ZADD` would re-add an entry this process had already lost — to a
 * fence, or to a pause long enough for the TTL to expire — and two owners is
 * exactly what the lease exists to prevent. Absent means lost: the caller
 * steps down.
 */
const REFRESH = `
  if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false then return 0 end
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return 1
`;

/** What the process does when it becomes active, and when it steps down. */
export type LeaseRuntime = {
  /** Start consuming: the NATS microservice listens. */
  activate: () => Promise<void>;
  /** Stop consuming and drop sockets, in that order. */
  deactivate: () => Promise<void>;
};

/**
 * One implementation serves at a time; the other waits warm.
 *
 * **A standby, not a refusal.** A refusal would put the JVM's whole startup
 * inside a switch window. A standby boots, warms, answers `/health` so the
 * kubelet leaves it alone, and answers `/health/ready` with 503 so the Service
 * sends it nothing — while consuming no NATS subject and accepting no socket.
 * The window then costs only the old pods draining plus one poll.
 *
 * **Per pod, not per implementation.** With `replicas: 2` a single shared key
 * would be deleted by the first pod to exit, handing over while the second is
 * still consuming. Each pod holds its own entry and a standby may become
 * active only when no unexpired entry of the OTHER implementation remains, so
 * replicas of one implementation join each other and the two implementations
 * still exclude.
 *
 * @example
 * // in main.ts, after the microservice is connected and before listen()
 * app.get(GatewayLeaseService).bind({ activate, deactivate });
 */
@Injectable()
export class GatewayLeaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(GatewayLeaseService.name);

  /** This process's entry. Unique per pod AND per restart. */
  private readonly podId = `${process.env.POD_NAME ?? hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  private readonly implementation: GatewayImplementation = 'node';

  private runtime?: LeaseRuntime;
  private timer?: NodeJS.Timeout;
  private active = false;
  private lastRefreshAt = 0;
  private stopping = false;

  constructor(private readonly redis: RedisService) {}

  /** True only while this process holds the lease — what readiness reports. */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Hands the lease what it starts and stops, and begins polling.
   *
   * Called from `main.ts` rather than injected because what it controls — the
   * microservice instance, the socket server — belongs to the composition
   * root, not to a provider.
   */
  async bind(runtime: LeaseRuntime): Promise<void> {
    this.runtime = runtime;
    await this.beat();

    this.timer = setInterval(() => {
      void this.beat();
    }, LEASE_REFRESH_MS);
    // Never hold the process open: a gateway whose only remaining handle is
    // this timer should exit.
    this.timer.unref();
  }

  /**
   * One beat: claim while standing by, refresh while active, fence if the
   * refresh has not succeeded for {@link LEASE_FENCE_MS}.
   *
   * Public because it is also how a test drives the lease. The alternative is
   * a suite that waits {@link LEASE_REFRESH_MS} per assertion, and a ten-second
   * row is a row that gets deleted rather than fixed. Nothing else calls it.
   */
  async beat(): Promise<void> {
    if (this.stopping) return;

    try {
      const now = Date.now();

      if (!this.active) {
        if (await this.claim(now)) await this.becomeActive();

        return;
      }

      if (await this.extend(now)) {
        this.lastRefreshAt = now;

        return;
      }

      this.logger.warn('Lease entry is gone — stepping down');
      await this.stepDown();
    } catch (error) {
      // Redis unreachable, or a script failure. Readiness already reports 503
      // for an unreachable Redis; what that does NOT stop is this process
      // consuming NATS and holding sockets, which is what the fence is for.
      this.logger.warn(`Lease beat failed: ${formatErrorMsg(error)}`);

      if (this.active && Date.now() - this.lastRefreshAt > LEASE_FENCE_MS) {
        this.logger.error(
          `No lease refresh for ${LEASE_FENCE_MS} ms — stepping down before the TTL`,
        );
        await this.stepDown();
      }
    }
  }

  private async claim(now: number): Promise<boolean> {
    const other = this.implementation === 'node' ? 'java' : 'node';
    const claimed = await this.redis.client.eval(
      CLAIM,
      2,
      holdersKey(this.implementation),
      holdersKey(other),
      String(now),
      String(now + LEASE_TTL_MS),
      this.podId,
      String(LEASE_TTL_MS),
    );

    return claimed === 1;
  }

  private async extend(now: number): Promise<boolean> {
    const extended = await this.redis.client.eval(
      REFRESH,
      1,
      holdersKey(this.implementation),
      String(now + LEASE_TTL_MS),
      this.podId,
      String(LEASE_TTL_MS),
    );

    return extended === 1;
  }

  private async becomeActive(): Promise<void> {
    this.lastRefreshAt = Date.now();
    await this.runtime?.activate();
    this.active = true;
    this.logger.log(
      `Holding the gateway lease as ${this.implementation} (${this.podId})`,
    );
  }

  /**
   * Stops serving, in the order that cannot overlap: not ready first, then
   * consuming, then sockets — and the entry last, so the lease is released
   * after this process has stopped rather than before.
   */
  private async stepDown(): Promise<void> {
    this.active = false;

    try {
      await this.runtime?.deactivate();
    } finally {
      await this.release();
    }

    this.logger.warn('Standing by — another implementation may take over');
  }

  private async release(): Promise<void> {
    try {
      await this.redis.client.zrem(holdersKey(this.implementation), this.podId);
    } catch (error) {
      // The entry expires on its own within the TTL; a failure here delays a
      // handover, it does not break one.
      this.logger.warn(`Lease release failed: ${formatErrorMsg(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.active) await this.stepDown();
  }
}

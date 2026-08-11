import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { formatErrorMsg } from '@synapsedesk/common';
import { RedisService } from '../../common/redis/redis.service';
import { PRESENCE_STATES, PresenceState } from './realtime.config';

/**
 * How long a presence record outlives its last heartbeat.
 *
 * **This TTL is the entire crash-recovery story.** A pod that dies never sends
 * `disconnect`, so anything derived from disconnect events leaks "online
 * forever" — and the leak is invisible, because the record looks exactly like a
 * live one. An expiring key needs no cleanup, no reaper job and no reconciler:
 * the absence of a heartbeat IS the offline signal.
 *
 * Sized at roughly twice the heartbeat interval, so one dropped refresh does not
 * flap a user offline.
 */
const PRESENCE_TTL_SECONDS = 60;

type PresenceRecord = {
  state: PresenceState;
  updatedAt: string;
};

/**
 * Presence, in Redis, keyed per USER — 22-doc §4.
 *
 * Three properties fight each other here, and every design that holds presence
 * in process memory loses at least one:
 *
 *   - **One user, many sockets.** Two tabs and a phone. Closing one tab is not
 *     going offline, so presence cannot be a property of a connection.
 *   - **Many gateway instances.** In-memory state is wrong the moment there are
 *     two pods — instance A cannot see that the same user is connected to
 *     instance B — and a pod that crashes never sends `disconnect`.
 *   - **Explicit beats inferred.** A user who set `busy` and then opens a new
 *     tab is still busy. Connection is a FLOOR, not a signal.
 *
 * One expiring key per user answers all three: it is shared across instances,
 * it survives a socket without depending on one, and it expires on its own.
 *
 * **Presence is not authorization.** An agent showing `busy` still receives
 * assignments — routing reads `users`, not this. Worth stating because "don't
 * assign to busy agents" is the first feature someone will infer from it, and
 * that belongs in the assignment rules with a real column behind it, not in a
 * key that vanishes after sixty seconds.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly redis: Redis;

  constructor(redis: RedisService) {
    // The SHARED connection — 29-doc §2. The error listener moved with it:
    // `RedisService` logs and never throws, which is what this one did, and an
    // unhandled `error` event is an unhandled rejection either way.
    this.redis = redis.client;
  }

  /**
   * A socket connected — set `online` only if NOTHING is recorded yet.
   *
   * **`SET … NX` rather than a plain write, and this is the whole multi-tab
   * rule.** A user who set `busy` and then opens a second tab is still busy; an
   * unconditional write on connect would silently reset them to `online` and
   * they would have no idea their colleagues were being told they were free.
   *
   * Returns the state now in force, or null if the store was unreachable —
   * distinct from "offline", because the caller must not announce a transition
   * it did not actually make.
   */
  async onConnect(
    organizationId: string,
    userId: string,
  ): Promise<PresenceState | null> {
    const key = this.key(organizationId, userId);

    try {
      const written = await this.redis.set(
        key,
        this.encode('online'),
        'EX',
        PRESENCE_TTL_SECONDS,
        'NX',
      );

      if (written) return 'online';

      // Something was already there — refresh its TTL without touching its
      // value, so an existing `busy` survives the new tab AND stays alive.
      await this.redis.expire(key, PRESENCE_TTL_SECONDS);

      return (await this.read(organizationId, userId)) ?? 'online';
    } catch (error) {
      this.logger.error(`Presence connect failed: ${formatErrorMsg(error)}`);
      return null;
    }
  }

  /**
   * An explicit `presence:update`, or a heartbeat.
   *
   * **Returns whether the STATE changed**, which is what makes the caller emit
   * on transition only. A heartbeat that merely refreshes a TTL is the common
   * case by a wide margin — once a minute per connected user — and broadcasting
   * it would give every agent N frames per minute per peer carrying no
   * information at all.
   *
   * Last write wins, with no merge and no precedence table. `presence:update` is
   * the only writer, so "wins" means "the user's most recent statement about
   * themselves", which is the only ordering that makes sense for a self-reported
   * status.
   */
  async set(
    organizationId: string,
    userId: string,
    state: PresenceState,
  ): Promise<{ changed: boolean; state: PresenceState }> {
    try {
      const previous = await this.read(organizationId, userId);

      await this.redis.set(
        this.key(organizationId, userId),
        this.encode(state),
        'EX',
        PRESENCE_TTL_SECONDS,
      );

      return { changed: previous !== state, state };
    } catch (error) {
      this.logger.error(`Presence write failed: ${formatErrorMsg(error)}`);
      // Reported as unchanged, so a store outage produces silence rather than a
      // storm of transitions nobody can trust.
      return { changed: false, state };
    }
  }

  /** The state on record, or null if the key has expired or never existed. */
  async read(
    organizationId: string,
    userId: string,
  ): Promise<PresenceState | null> {
    const raw = await this.redis.get(this.key(organizationId, userId));
    if (!raw) return null;

    try {
      const record = JSON.parse(raw) as PresenceRecord;
      return PRESENCE_STATES.includes(record.state) ? record.state : null;
    } catch {
      // A malformed value is treated as absent rather than crashing the read.
      // The key expires within a minute regardless.
      return null;
    }
  }

  /**
   * The TTL, refreshed without changing the value.
   *
   * Deliberately NOT a write: `set` would need the current state, and reading it
   * back only to write it unchanged is a round trip that buys nothing and opens
   * a window where a concurrent `presence:update` is overwritten by a stale
   * value a heartbeat happened to be holding.
   */
  async heartbeat(organizationId: string, userId: string): Promise<void> {
    try {
      await this.redis.expire(
        this.key(organizationId, userId),
        PRESENCE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(`Presence heartbeat failed: ${formatErrorMsg(error)}`);
    }
  }

  /**
   * **There is no `onDisconnect`, and that is deliberate.**
   *
   * Deleting the key when a socket closes would take a user offline the moment
   * they close ONE of three tabs. Counting sockets instead would need a counter
   * that a crashed pod never decrements — the leak the TTL exists to avoid,
   * reintroduced one layer down. Letting the key expire handles the clean close,
   * the abrupt close and the dead pod with the same mechanism.
   */
  private key(organizationId: string, userId: string): string {
    return `presence:${organizationId}:${userId}`;
  }

  private encode(state: PresenceState): string {
    return JSON.stringify({
      state,
      updatedAt: new Date().toISOString(),
    } satisfies PresenceRecord);
  }
}

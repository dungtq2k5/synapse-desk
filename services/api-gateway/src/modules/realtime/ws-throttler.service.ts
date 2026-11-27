import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Socket } from 'socket.io';
import { RedisService } from '../../common/redis/redis.service';
import { socketIp } from '../../common/utils/client-ip';

/**
 * Counts a key once and starts its window on the first hit, in one step, so a
 * key can never be left without an expiry. The Java gateway runs the same
 * script on the same keys, so a client has one budget whichever gateway it
 * reaches.
 */
const COUNT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

/** A limit: at most `limit` inside each window of `ttlMs`. */
type Limit = { limit: number; ttlMs: number };

/**
 * The socket handshake's limits, in layers, each keyed on the best thing
 * known at its stage, and the per-event limit.
 *
 * - **Flood ceiling**, before the token is checked: the client IP
 *   (`ws_handshake:flood:<ip>`). High enough for an office reconnecting
 *   together.
 * - **Failed handshakes**: the client IP (`ws_handshake:failed:<ip>`),
 *   charged only by a handshake with no verified identity (no cookie, a bad
 *   signature, a malformed token or the wrong key), after the token is
 *   checked. So a valid user from an address that is forging still connects;
 *   a verification costs about 0.05 ms, little next to the handshake.
 * - **Per user**: the verified `sub` (`ws_handshake:user:<sub>`), charged by
 *   every handshake whose signature verifies, expired or revoked included.
 *
 * Past any limit the handshake is shed, never blocked: the client retries on
 * its backoff once the window moves. Nothing the client chooses is in a key.
 * The counters live in the Redis every replica shares, so the budget is the
 * system's, not one replica's. A Redis failure allows the handshake, loudly.
 */
@Injectable()
export class WsThrottlerService {
  private readonly logger = new Logger(WsThrottlerService.name);
  private readonly redis: Redis;
  private readonly flood: Limit;
  private readonly failed: Limit;
  private readonly perUser: Limit;

  constructor(redis: RedisService, config: ConfigService) {
    this.redis = redis.client;
    this.flood = {
      limit: config.getOrThrow<number>('WS_HANDSHAKE_LIMIT'),
      ttlMs: config.getOrThrow<number>('WS_HANDSHAKE_TTL'),
    };
    this.failed = {
      limit: config.getOrThrow<number>('WS_HANDSHAKE_FAILED_LIMIT'),
      ttlMs: config.getOrThrow<number>('WS_HANDSHAKE_FAILED_TTL'),
    };
    this.perUser = {
      limit: config.getOrThrow<number>('WS_HANDSHAKE_USER_LIMIT'),
      ttlMs: config.getOrThrow<number>('WS_HANDSHAKE_USER_TTL'),
    };
  }

  /** Counts a handshake from this socket's address against the flood ceiling. */
  allowHandshake(client: Socket): Promise<boolean> {
    return this.count(
      `ws_handshake:flood:${socketIp(client)}`,
      this.flood,
      'Handshake throttle storage unavailable',
    );
  }

  /**
   * Counts a handshake that had no verified identity against its address;
   * false once the address is past the failed-handshake limit.
   */
  allowFailed(client: Socket): Promise<boolean> {
    return this.count(
      `ws_handshake:failed:${socketIp(client)}`,
      this.failed,
      'Handshake throttle storage unavailable',
    );
  }

  /** Counts a handshake whose signature verified against its user. */
  allowUser(sub: string): Promise<boolean> {
    return this.count(
      `ws_handshake:user:${sub}`,
      this.perUser,
      'Handshake throttle storage unavailable',
    );
  }

  /** Counts an event from this socket's verified user; one with no user is refused. */
  allowEvent(
    client: Socket,
    event: string,
    limit: number,
    ttlMs: number,
  ): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const subject = (client.data.user as { sub?: string } | undefined)?.sub;
    if (!subject) return Promise.resolve(false);

    return this.count(
      `ws_event:${event}:${subject}`,
      { limit, ttlMs },
      `Event throttle storage unavailable (${event})`,
    );
  }

  /** Whether `key` is still within `limit` after this hit. Fails open, loudly. */
  private async count(
    key: string,
    { limit, ttlMs }: Limit,
    failure: string,
  ): Promise<boolean> {
    try {
      const hits = Number(await this.redis.eval(COUNT, 1, key, ttlMs));
      return hits <= limit;
    } catch (error) {
      this.storageFailed(failure, error);
      return true;
    }
  }

  private storageFailed(message: string, error: unknown): void {
    this.logger.error(
      `${message}; allowing it: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Socket } from 'socket.io';

/**
 * Flood control for the WebSocket HANDSHAKE.
 *
 * `SmartThrottlerGuard` cannot do this: it is an HTTP guard on a route, and a
 * socket handshake is neither. Without something here, `/ws` is the one
 * unmetered entry point in the gateway — and it is the cheapest to abuse, since
 * an unauthenticated connection attempt costs a JWT verification and a Redis
 * round trip before it is refused.
 *
 * **Reuses the injected `ThrottlerStorage`**, which is already the Redis-backed
 * one the HTTP throttler uses. That is the whole design: no second store, no
 * second configuration, and the limit is a property of the SYSTEM rather than
 * of one replica — a per-process counter would be N times the intended budget
 * behind a load balancer, which is the same trap the HTTP tier avoids.
 */
@Injectable()
export class WsThrottlerService {
  private readonly logger = new Logger(WsThrottlerService.name);

  private readonly LIMIT: number;
  private readonly TTL: number;
  private readonly BLOCK_DURATION: number;

  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
    configService: ConfigService,
  ) {
    this.LIMIT = configService.getOrThrow<number>('WS_HANDSHAKE_LIMIT');
    this.TTL = configService.getOrThrow<number>('WS_HANDSHAKE_TTL');
    this.BLOCK_DURATION = configService.getOrThrow<number>(
      'WS_HANDSHAKE_BLOCK_DURATION',
    );
  }

  /**
   * Returns false and hangs up if this address is flooding.
   *
   * Keyed on IP, unlike the HTTP tier's per-account keying, and that difference
   * is forced: at handshake time nothing has been verified yet — the cookie is
   * an unvalidated string — so there is no identity to key on that an attacker
   * could not simply invent. IP is the only thing observed rather than claimed.
   *
   * The NAT cost is real and accepted here: a whole office shares one budget for
   * OPENING connections. The limit is sized for that (many per minute, not
   * five), and the consequence of exhausting it is a retry, not a lockout.
   */
  async allowHandshake(client: Socket, gatewayName: string): Promise<boolean> {
    // `handshake.address` rather than `client.conn.remoteAddress`: Socket.IO
    // resolves the former through the `trust proxy` setting Express already
    // applies, so behind a load balancer it is the real client.
    const ip = client.handshake.address;
    const key = `ws_handshake:${gatewayName}:${ip}`;

    try {
      const { totalHits } = await this.storage.increment(
        key,
        this.TTL,
        this.LIMIT,
        this.BLOCK_DURATION,
        gatewayName,
      );

      if (totalHits > this.LIMIT) {
        this.logger.warn(
          `Handshake flood blocked on [${gatewayName}] from ${ip} (${totalHits} hits)`,
        );
        // `true` closes the underlying connection rather than just the
        // Socket.IO session — an attacker who ignores the disconnect frame
        // still loses the socket.
        client.disconnect(true);
        return false;
      }

      return true;
    } catch (error) {
      // FAIL OPEN, loudly — the same trade `SmartThrottlerGuard` makes. A Redis
      // outage must not become a total real-time outage; while it lasts the
      // handshake limit is not enforced, and this log line is the signal that
      // the protection is off. It must be alerted on.
      this.logger.error(
        `Handshake throttle storage unavailable; allowing connection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }
}

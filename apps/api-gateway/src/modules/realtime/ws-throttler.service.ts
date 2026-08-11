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

  /**
   * Flood control for an authenticated C→S **event** — 22-doc §6.3.
   *
   * `allowHandshake` above guards only the connection. Every client-to-server
   * handler needs this too, and `message:send` needs it most: it reaches the
   * same RPC as `POST /tickets/:id/messages`, so without a limit here the socket
   * is a rate-limit bypass for the endpoint the HTTP tier carefully throttles.
   *
   * **Keyed on the USER, not the IP**, which is the opposite of the handshake
   * and for a reason that has flipped: by the time a frame arrives the token has
   * been verified, so there is a real identity to key on — and keying on IP
   * would make one office share one budget for sending messages, which is the
   * NAT cost the handshake accepts and a message path should not.
   *
   * Returns false rather than throwing, so a caller decides whether to drop
   * silently (typing) or tell the client (`message:send`). The two want opposite
   * things: a dropped typing frame is invisible and correct, while a dropped
   * message needs to surface or the user's text disappears.
   */
  async allowEvent(
    client: Socket,
    event: string,
    limit: number,
    ttlMs: number,
  ): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const subject = (client.data.user as { sub?: string } | undefined)?.sub;
    // No verified identity means the socket never authenticated. Refused rather
    // than allowed — the handler would refuse it a line later anyway, and doing
    // it here keeps an unauthenticated frame from costing a storage round trip.
    if (!subject) return false;

    const key = `ws_event:${event}:${subject}`;

    try {
      const { totalHits } = await this.storage.increment(
        key,
        ttlMs,
        limit,
        // No block duration: exceeding an event limit is ordinary client
        // behaviour — a held key, a reconnect storm — and locking the user out
        // for five minutes for typing too fast is a worse product than dropping
        // the frame.
        0,
        event,
      );

      return totalHits <= limit;
    } catch (error) {
      // FAIL OPEN, like the handshake and the HTTP tier. A Redis outage must not
      // silently stop message delivery; the log line is the signal that the
      // limit is off.
      this.logger.error(
        `Event throttle storage unavailable; allowing ${event}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }
}

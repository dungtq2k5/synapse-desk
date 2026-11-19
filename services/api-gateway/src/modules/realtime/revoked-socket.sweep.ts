import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CONNECTION_REFUSED_CODES,
  type MaybeJwtPayload,
} from '@synapsedesk/contracts';
import type { Socket } from 'socket.io';
import { RevokedSessionsService } from '../../common/redis/revoked-sessions.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Disconnects the sockets of a revoked session.
 *
 * A socket authenticates once, at the handshake, which refuses a revoked
 * session; one already connected would otherwise outlive it. Every
 * {@link RevokedSocketSweep.INTERVAL_MS} this reads, in one Redis call, which
 * of this replica's connected sockets belong to a revoked family, and refuses
 * them (`connection:refused`, `UNAUTHENTICATED`). Polled rather than pushed:
 * the revocation is already a Redis key, so a poll needs no event and no
 * consumer.
 */
@Injectable()
export class RevokedSocketSweep
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  /** How long a revoked session's socket can stay connected, at most. */
  static readonly INTERVAL_MS = 5_000;

  private readonly logger = new Logger(RevokedSocketSweep.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly revokedSessions: RevokedSessionsService,
  ) {}

  onApplicationBootstrap(): void {
    // `unref`: a pending sweep never holds the process open on shutdown.
    this.timer = setInterval(
      () => void this.sweep(),
      RevokedSocketSweep.INTERVAL_MS,
    ).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass: refuses every connected socket whose family is revoked. */
  async sweep(): Promise<void> {
    const held: { socket: Socket; sid: string }[] = [];
    for (const socket of this.gateway.server?.sockets?.values() ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const sid = (socket.data.user as MaybeJwtPayload | undefined)?.sid;
      if (sid) held.push({ socket, sid });
    }
    if (held.length === 0) return;

    const revoked = await this.revokedSessions.revokedAmong(
      held.map(({ sid }) => sid),
    );
    for (const { socket, sid } of held) {
      if (!revoked.has(sid)) continue;
      this.logger.log(
        `Disconnecting socket ${socket.id}: its session was revoked`,
      );
      this.gateway.refuse(
        socket,
        CONNECTION_REFUSED_CODES.unauthenticated,
        'Sign in again',
      );
    }
  }
}

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { RedisService } from '../../common/redis/redis.service';

/**
 * The agents viewing each ticket, across every replica: one Redis sorted set
 * per ticket, `ticket-viewers:{ticketId}`, whose members are
 * `{userId}|{socketId}`, scored by when the entry lapses.
 *
 * **A socket, not a user, is the entry.** An agent with the ticket open in two
 * tabs is one viewer until both have left, so {@link viewerIds} answers
 * distinct user ids.
 *
 * **A dead replica's entries lapse.** Each replica re-scores its own sockets
 * every {@link TicketViewers.REFRESH_MS}, and a read drops every entry past its
 * score. A replica that dies stops re-scoring, so its sockets leave the list
 * within {@link TicketViewers.TTL_MS}; the change is seen at the ticket's next
 * join, leave or disconnect, which is when a list is sent.
 *
 * @example await viewers.join('t1', socket.id, 'u1'); await viewers.viewerIds('t1')
 */
@Injectable()
export class TicketViewers
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  static readonly TTL_MS = 90_000;
  /** A third of the TTL: two refreshes can miss. */
  static readonly REFRESH_MS = 30_000;

  private readonly logger = new Logger(TicketViewers.name);
  /** This replica's entries: socket id → (ticket id → user id). */
  private readonly local = new Map<string, Map<string, string>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly redis: RedisService) {}

  onApplicationBootstrap(): void {
    // `unref`: a pending refresh never holds the process open on shutdown.
    this.timer = setInterval(
      () => void this.refresh(),
      TicketViewers.REFRESH_MS,
    ).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Records a socket viewing a ticket. */
  async join(ticketId: string, socketId: string, userId: string) {
    const tickets = this.local.get(socketId) ?? new Map<string, string>();
    tickets.set(ticketId, userId);
    this.local.set(socketId, tickets);
    await this.record(ticketId, member(userId, socketId));
  }

  /** Forgets a socket's view of a ticket; `false` when it had none. */
  async leave(ticketId: string, socketId: string): Promise<boolean> {
    const userId = this.local.get(socketId)?.get(ticketId);
    if (userId === undefined) return false;
    this.local.get(socketId)!.delete(ticketId);
    await this.redis.client.zrem(key(ticketId), member(userId, socketId));
    return true;
  }

  /** Forgets every view a closing socket held; answers the tickets it left. */
  async disconnect(socketId: string): Promise<string[]> {
    const tickets = this.local.get(socketId);
    this.local.delete(socketId);
    if (!tickets) return [];
    await Promise.all(
      [...tickets].map(([ticketId, userId]) =>
        this.redis.client.zrem(key(ticketId), member(userId, socketId)),
      ),
    );
    return [...tickets.keys()];
  }

  /** The distinct agents viewing a ticket now, lapsed entries dropped first. */
  async viewerIds(ticketId: string): Promise<string[]> {
    await this.redis.client.zremrangebyscore(key(ticketId), '-inf', Date.now());
    const members = await this.redis.client.zrange(key(ticketId), '0', '-1');
    return [...new Set(members.map((entry) => entry.split('|')[0]))];
  }

  /** Re-scores this replica's entries, so only a dead replica's lapse. */
  async refresh(): Promise<void> {
    try {
      for (const [socketId, tickets] of this.local) {
        for (const [ticketId, userId] of tickets) {
          await this.record(ticketId, member(userId, socketId));
        }
      }
    } catch (error) {
      this.logger.warn(
        `Ticket viewers not refreshed: ${formatErrorMsg(error)}`,
      );
    }
  }

  private async record(ticketId: string, entry: string): Promise<void> {
    await this.redis.client.zadd(
      key(ticketId),
      Date.now() + TicketViewers.TTL_MS,
      entry,
    );
    // The set itself goes once every entry has lapsed.
    await this.redis.client.pexpire(key(ticketId), TicketViewers.TTL_MS);
  }
}

const key = (ticketId: string) => `ticket-viewers:${ticketId}`;
const member = (userId: string, socketId: string) => `${userId}|${socketId}`;

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Socket } from 'socket.io';
import { firstValueFrom, timeout } from 'rxjs';
import {
  GRPC_DEADLINE_MS,
  packRequestContext,
  TICKET_GRPC_CLIENT,
  TICKET_SERVICE_NAME,
  TicketResponse,
  TicketServiceClient,
} from '@synapsedesk/grpc-proto';
import { JwtPayload } from '@synapsedesk/common';

/**
 * "May this person watch this ticket?" — asked once, answered once.
 *
 * The rule is the same one `GET /tickets/:id` enforces, and that is the entire
 * reason this is a service rather than a few lines in the gateway's join
 * handler. Two encodings of the same rule diverge the first time one is
 * updated, and the divergence here is silent: a client that cannot READ a
 * ticket over HTTP would still receive its every message in real time.
 *
 * The check runs against ticket-service, not against a local cache, because
 * `current_assignee_id` changes without the gateway hearing about it — a
 * membership decided at connect time and never re-checked would keep a
 * reassigned agent watching a ticket they no longer own.
 */
@Injectable()
export class TicketAccessService implements OnModuleInit {
  private readonly logger = new Logger(TicketAccessService.name);
  private ticketService!: TicketServiceClient;

  constructor(
    @Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.ticketService =
      this.client.getService<TicketServiceClient>(TICKET_SERVICE_NAME);
  }

  /**
   * Three ways in, and no fourth:
   *
   *   1. `ticket.read.all` — an agent with the tenant queue.
   *   2. The author.
   *   3. The current assignee.
   *
   * Past assignees are deliberately NOT included, even though `api-endpoints-plan`
   * lists them for the HTTP route. A past assignee reading the thread is a
   * historical lookup; a past assignee receiving LIVE updates to a ticket they
   * were taken off is a subscription nobody asked to keep, and it grows without
   * bound as tickets move around. If that turns out to be wanted, it is one
   * predicate here — and one place to change, which is the point.
   *
   * Fails CLOSED on every error path: an unreachable peer, a malformed reply, a
   * timeout. Denying a legitimate watcher costs them a page refresh; allowing an
   * illegitimate one leaks a customer's support thread.
   */
  async canRead(
    ticketId: string,
    caller: JwtPayload,
    client: Socket,
  ): Promise<boolean> {
    if (caller.permissionCodes.includes('ticket.read.all')) {
      // Still tenant-scoped: the RPC below applies `tenantScope`, so an agent
      // with the permission cannot reach another tenant's ticket. Returning
      // early here would skip that — so it does not.
      return this.resolvesInTenant(ticketId, caller, client);
    }

    const ticket = await this.load(ticketId, caller, client);
    if (!ticket) return false;

    return (
      ticket.authorId === caller.sub || ticket.currentAssigneeId === caller.sub
    );
  }

  private async resolvesInTenant(
    ticketId: string,
    caller: JwtPayload,
    client: Socket,
  ): Promise<boolean> {
    return (await this.load(ticketId, caller, client)) !== null;
  }

  /**
   * Returns null rather than throwing, for anything.
   *
   * The caller's only question is boolean, and a NOT_FOUND from the tenant
   * filter is indistinguishable from a wrong id by design — turning either into
   * an exception would make the join handler's error path report which of the
   * two it was.
   */
  private async load(
    ticketId: string,
    caller: JwtPayload,
    client: Socket,
  ): Promise<TicketResponse | null> {
    try {
      return await firstValueFrom(
        this.ticketService
          .getTicket(
            { id: ticketId },
            // The caller's verified context, packed exactly as an HTTP route
            // would pack it — which is what makes ticket-service apply the same
            // tenant filter to this lookup as to `GET /tickets/:id`.
            packRequestContext({
              ...caller,
              ip: client.handshake.address,
              userAgent:
                (client.handshake.headers['user-agent'] as string) ?? '',
            }),
          )
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );
    } catch (error) {
      // Logged at DEBUG, not WARN: a refused join is an ordinary outcome — a
      // stale tab, a deleted ticket, a guessed id — and logging every one at
      // warning level would bury the ones that matter.
      this.logger.debug(
        `Ticket ${ticketId} not readable by ${caller.sub}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

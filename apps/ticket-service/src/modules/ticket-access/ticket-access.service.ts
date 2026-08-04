import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { CallerContext } from '@synapsedesk/grpc-proto';
import { tenantScope } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Ticket } from '../../generated/prisma/client';

/**
 * "May this caller see this ticket?" — the one answer, in one place.
 *
 * Extracted from `TicketsService` when `AiService` needed the same check.
 * `AiModule` could not import `TicketsModule` without creating a cycle, because
 * escalation has to call INTO the AI module — and a cycle is the #1 cause of
 * runtime crashes in Nest, so `forwardRef` was the wrong fix. The right one is
 * the third module both sides depend on.
 *
 * Copying the predicate into each consumer would have avoided the cycle too,
 * and would have been the actual bug: five copies of a visibility filter drift,
 * and the first one that drifts leaks another tenant's support tickets.
 */
@Injectable()
export class TicketAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A single ticket the caller may see, or NOT_FOUND.
   *
   * `findFirst` with the scope spread in, never `findUnique({ where: { id } })`
   * — `findUnique` cannot express a tenant filter, so it would happily return
   * another tenant's row and the handler would 200 it.
   *
   * NOT_FOUND rather than PERMISSION_DENIED for a row that exists but is not
   * theirs: "you may not see this" confirms the ticket exists, which turns id
   * enumeration into a tenant-membership oracle.
   */
  async load(ticketId: string, context: CallerContext): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...tenantScope(context),
        ...this.visibilityScope(context),
      },
    });
    if (!ticket) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No ticket with that id',
      });
    }

    return ticket;
  }

  /**
   * The tenant filter, plus a NARROWER one for anyone without the queue.
   *
   * `tenantScope` alone is not enough, and this is the easiest thing in the
   * service to forget. A tenant has one shared ticket table; without the second
   * predicate every end user could read every colleague's support ticket —
   * including the ones about them.
   *
   * Returns `{}` for an agent, so a caller can spread both unconditionally.
   */
  visibilityScope(context: CallerContext): Prisma.TicketWhereInput {
    if (context.isSuperAdmin) return {};
    if (context.permissionCodes.includes('ticket.read.all')) return {};

    // Mine to raise, or mine to work. Past assignees are excluded: the
    // assignment history is a separate read, and a ticket that left an agent's
    // queue has left their list.
    return {
      OR: [
        { authorId: context.sub ?? '' },
        { currentAssigneeId: context.sub ?? '' },
      ],
    };
  }
}

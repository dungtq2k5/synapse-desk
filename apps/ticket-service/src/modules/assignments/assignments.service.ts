import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AssignmentResponse,
  AssignTicketRequest,
  AssignTicketToSelfRequest,
  CallerContext,
  ListAssignmentsRequest,
  ListAssignmentsResponse,
  UnassignTicketRequest,
  UnassignTicketResponse,
} from '@synapsedesk/grpc-proto';
import {
  isUniqueConstraintViolation,
  ReassignmentReason,
  requireActor,
  TICKET_PATTERNS,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { TicketEventPublisher } from '../events/ticket-event.publisher';
import { TicketsService } from '../tickets/tickets.service';
import { Prisma, TicketAssignment } from '../../generated/prisma/client';
import { fromProtoReason, toAssignmentResponse } from './assignment.mapper';

/** The partial unique index the seeder applies: one live assignment per ticket. */
const CURRENT_ASSIGNMENT_INDEX = 'ticket_assignments_current_key';

/**
 * Assignment history, and the invariant that makes it trustworthy.
 *
 * Two representations of the same fact live side by side: the `ticket_assignments`
 * ledger (every assignment a ticket ever had) and `tickets.current_assignee_id`
 * /`current_department_id` (a denormalized cache of the live one). `GET /tickets`
 * filters and displays from the CACHE — a join per row across a queue view is
 * the query this service is most likely to be judged on — so the two must never
 * disagree.
 *
 * They are kept in step by construction, not by discipline: every mutation goes
 * through `writeAssignment`, one transaction, and there is no other path that
 * touches either representation.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
    private readonly events: TicketEventPublisher,
    private readonly tickets: TicketsService,
  ) {}

  /**
   * Assign, or reassign — the same operation.
   *
   * Which one it IS is decided by the data (was there a live assignment?), not
   * by which RPC was called. A client that calls `AssignTicket` on an
   * already-assigned ticket gets a correct `ticket.reassigned` event rather
   * than a wrong `ticket.assigned` one, and the two RPCs cannot drift because
   * they are one method.
   */
  assignTicket(
    request: AssignTicketRequest,
    context: CallerContext,
  ): Promise<AssignmentResponse> {
    return this.writeAssignment(
      request.ticketId,
      request.assigneeId,
      request.departmentId,
      fromProtoReason(request.reason),
      context,
    );
  }

  /**
   * An agent claiming a ticket. The SAME write path with the assignee fixed.
   *
   * A distinct RPC only so the gateway can permission it separately
   * (`ticket.assign.self` is handed out far more freely than `ticket.assign`).
   * If this ever grows its own transaction, the two will drift the first time
   * one gets a fix — which is the whole reason `writeAssignment` exists.
   *
   * `async` matters here, unlike on `assignTicket`: `requireActor` runs in the
   * argument list, so without it a caller with no identity would get a
   * SYNCHRONOUS throw from a method whose signature promises a rejection —
   * and anything using `.catch()` rather than `try` would crash instead.
   */
  async assignTicketToSelf(
    request: AssignTicketToSelfRequest,
    context: CallerContext,
  ): Promise<AssignmentResponse> {
    return this.writeAssignment(
      request.ticketId,
      requireActor(context),
      request.departmentId,
      ReassignmentReason.SELF_ASSIGNED,
      context,
    );
  }

  /**
   * Back to the department queue: close the live row, create none, clear both
   * cached columns.
   */
  async unassignTicket(
    request: UnassignTicketRequest,
    context: CallerContext,
  ): Promise<UnassignTicketResponse> {
    const ticket = await this.tickets.load(request.ticketId, context);
    const current = await this.loadCurrent(ticket.id);

    if (!current) {
      // FAILED_PRECONDITION (409), not NOT_FOUND: the ticket exists and the
      // caller may see it. What is wrong is the STATE they assumed — and
      // answering 404 would send them looking for a missing ticket.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'That ticket is not currently assigned to anyone',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.closeCurrent(tx, current.id);
      await this.syncTicketCache(tx, ticket.id, null, null);
    });

    this.events.publish({
      pattern: TICKET_PATTERNS.unassigned,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      occurredAt: new Date().toISOString(),
      previousAssigneeId: current.assignedToId,
    });

    return {};
  }

  /**
   * The whole lifecycle, oldest first.
   *
   * Not paginated, deliberately: an assignment history is bounded by how many
   * times a human moved one ticket, which is single digits in practice and
   * never the thousands that would justify a page cursor. Reading it as one
   * list is also what makes it USEFUL — the question it answers is "how did
   * this ticket get here", and that is a sequence, not a page of one.
   */
  async listAssignments(
    request: ListAssignmentsRequest,
    context: CallerContext,
  ): Promise<ListAssignmentsResponse> {
    // Through `load`, so the tenant and author/assignee filters apply. Querying
    // `ticket_assignments` by `ticketId` alone would be an unscoped read — the
    // table has no `organization_id` of its own to filter on.
    const ticket = await this.tickets.load(request.ticketId, context);

    const items = await this.prisma.ticketAssignment.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });

    return { items: items.map(toAssignmentResponse) };
  }

  // -------------------------------------------------------------------------

  /**
   * THE write path. One transaction, three steps, in this order:
   *
   *   1. close the live row (`unassigned_at`, `is_current = false`)
   *   2. insert the new row (`is_current = true`)
   *   3. update the denormalized columns on `tickets`
   *
   * Step 3 is the one that gets forgotten, and forgetting it is invisible: the
   * ledger stays perfectly correct while the queue view every agent actually
   * looks at shows the previous assignee. That is why it is a named step with
   * its own test rather than a trailing line.
   *
   * The event is published AFTER the commit, never inside it — an announcement
   * of an assignment a rollback erased is one no consumer can un-handle.
   */
  private async writeAssignment(
    ticketId: string,
    assigneeId: string,
    departmentId: string,
    requestedReason: ReassignmentReason | null,
    context: CallerContext,
  ): Promise<AssignmentResponse> {
    const ticket = await this.tickets.load(ticketId, context);
    const actorId = requireActor(context);

    if (!assigneeId || !departmentId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Both an assignee and a department are required',
      });
    }

    // BEFORE the transaction, not inside it. Both are network calls to
    // auth-service, and holding a row lock open across a remote round trip is
    // how one slow peer becomes a table full of blocked writers.
    await this.authReference.assertUserExists(assigneeId, context);
    await this.authReference.assertDepartmentExists(departmentId, context);

    const previous = await this.loadCurrent(ticket.id);

    if (previous?.assignedToId === assigneeId) {
      // Refused rather than written as a no-op row. A second identical
      // assignment would add a meaningless entry to the history and fire a
      // `reassigned` event that notifies the assignee about a change that did
      // not happen.
      //
      // ALREADY_EXISTS, not FAILED_PRECONDITION: the gateway maps the former to
      // 409 and the latter to 400 (a repo-wide table set in Domain A), and this
      // is a conflict with existing state rather than a malformed request —
      // there is nothing in the body for the caller to fix.
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'That ticket is already assigned to that user',
      });
    }

    // INITIAL genuinely means "the first one". Defaulting a later assignment to
    // it would make the history read as though the ticket had been assigned
    // from scratch each time.
    const reason =
      requestedReason ??
      (previous ? ReassignmentReason.MANUAL : ReassignmentReason.INITIAL);

    const assignment = await this.writeTransaction(
      ticket.id,
      previous,
      assigneeId,
      departmentId,
      reason,
      actorId,
    );

    // `assigned` vs `reassigned` follows the DATA, not the RPC name — see
    // `assignTicket`.
    this.events.publish(
      previous
        ? {
            pattern: TICKET_PATTERNS.reassigned,
            organizationId: ticket.organizationId,
            ticketId: ticket.id,
            occurredAt: new Date().toISOString(),
            fromAssigneeId: previous.assignedToId,
            toAssigneeId: assigneeId,
            departmentId,
            assignedById: actorId,
            reason,
          }
        : {
            pattern: TICKET_PATTERNS.assigned,
            organizationId: ticket.organizationId,
            ticketId: ticket.id,
            occurredAt: new Date().toISOString(),
            assignedToId: assigneeId,
            departmentId,
            assignedById: actorId,
          },
    );

    return toAssignmentResponse(assignment);
  }

  /**
   * The three steps, atomically.
   *
   * A concurrent caller doing the same thing is caught by
   * `ticket_assignments_current_key`, the partial unique index on
   * `(ticket_id) WHERE is_current = true`. Two racing reassignments both read
   * the same `previous`, both close it, and both try to insert a live row —
   * and the database refuses the second. That refusal is the ONLY thing
   * standing between this and a ticket with two simultaneous assignees, which
   * is not a state the product has any meaning for.
   */
  private async writeTransaction(
    ticketId: string,
    previous: TicketAssignment | null,
    assigneeId: string,
    departmentId: string,
    reason: ReassignmentReason,
    actorId: string,
  ): Promise<TicketAssignment> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (previous) await this.closeCurrent(tx, previous.id);

        const assignment = await tx.ticketAssignment.create({
          data: {
            ticketId,
            assignedToId: assigneeId,
            assignedById: actorId,
            departmentId,
            reason,
            isCurrent: true,
          },
        });

        await this.syncTicketCache(tx, ticketId, assigneeId, departmentId);

        return assignment;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, CURRENT_ASSIGNMENT_INDEX)) {
        // ABORTED -> 409 at the gateway. The caller's request was well formed
        // and they were allowed to make it; somebody else simply got there
        // first. Retrying is the correct response, which is what 409 says and
        // what 500 would not.
        throw new RpcException({
          code: status.ABORTED,
          message:
            'That ticket was reassigned by someone else at the same time; please retry',
        });
      }
      throw error;
    }
  }

  private closeCurrent(
    tx: Prisma.TransactionClient,
    assignmentId: string,
  ): Promise<TicketAssignment> {
    return tx.ticketAssignment.update({
      where: { id: assignmentId },
      data: { isCurrent: false, unassignedAt: new Date() },
    });
  }

  /**
   * Step 3, named so it can be tested — and so it is hard to leave out.
   *
   * Both columns move together, always. Setting the assignee while leaving a
   * stale department is what makes a ticket show up in one team's queue with
   * another team's agent on it.
   */
  private async syncTicketCache(
    tx: Prisma.TransactionClient,
    ticketId: string,
    assigneeId: string | null,
    departmentId: string | null,
  ): Promise<void> {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        currentAssigneeId: assigneeId,
        currentDepartmentId: departmentId,
      },
    });
  }

  private loadCurrent(ticketId: string): Promise<TicketAssignment | null> {
    return this.prisma.ticketAssignment.findFirst({
      where: { ticketId, isCurrent: true },
    });
  }
}

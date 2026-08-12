import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ListTicketsByIdsRequest,
  ListTicketsByIdsResponse,
  BulkTicketFailure,
  BulkTicketStatusRequest,
  BulkTicketStatusResponse,
  CallerContext,
  ChangeTicketStatusRequest,
  CreateTicketRequest,
  DeleteTicketResponse,
  emptyPage,
  GetTicketByNumberRequest,
  GetTicketRequest,
  ListTicketsRequest,
  ListTicketsResponse,
  TicketIdRequest,
  TicketResponse,
  toPageMeta,
  toPrismaPage,
  toSearchFilter,
  UpdateTicketRequest,
} from '@synapsedesk/grpc-proto';
import {
  BATCH_ID_LIMIT,
  normalizeBatchIds,
  formatErrorMsg,
  MAX_BULK_TICKET_IDS,
  requireActor,
  requireTenant,
  restoreData,
  softDeleteData,
  TICKET_PATTERNS,
  TICKET_SORTABLE_FIELDS,
  TicketPriority,
  TicketSource,
  TicketStatus,
  tenantScope,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { recordInboundEmail, withInboundDedup } from './inbound-dedup';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { AiService } from '../ai/ai.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { TicketEventPublisher } from '../events/ticket-event.publisher';
import { Prisma, Ticket } from '../../generated/prisma/client';
import {
  assertKnownStatus,
  assertTransition,
  transitionSideEffects,
} from '../../common/utils/ticket-state';
import {
  fromProtoTicketPriority,
  fromProtoTicketSource,
  fromProtoTicketStatus,
  toTicketResponse,
} from './ticket.mapper';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
    private readonly events: TicketEventPublisher,
    private readonly access: TicketAccessService,
    private readonly ai: AiService,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async getTicket(
    request: GetTicketRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(await this.load(request.id, context));
  }

  /**
   * The human-facing lookup: "ticket #4211".
   *
   * Still tenant-scoped despite the number being globally unique. Without the
   * scope this would be an enumeration oracle over every tenant's tickets —
   * incrementing an integer is a great deal easier than guessing a UUID, which
   * is precisely why a global sequence needs the filter more than an id does.
   */
  async getTicketByNumber(
    request: GetTicketByNumberRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        ticketNumber: BigInt(request.ticketNumber),
        ...tenantScope(context),
        ...this.visibilityScope(context),
      },
    });
    if (!ticket) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No ticket with that number',
      });
    }

    return toTicketResponse(ticket);
  }

  async listTickets(
    request: ListTicketsRequest,
    context: CallerContext,
  ): Promise<ListTicketsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, TICKET_SORTABLE_FIELDS);

    const search = toSearchFilter(page.searchTerm);
    const statusFilter = fromProtoTicketStatus(request.status);
    const priorityFilter = fromProtoTicketPriority(request.priority);
    const sourceFilter = fromProtoTicketSource(request.source);

    const where: Prisma.TicketWhereInput = {
      ...tenantScope(context),
      ...this.visibilityScope(context),
      // `tenantScope` always pins `deletedAt: null`; an admin asking for the
      // recycle bin overrides it. Spread AFTER, or the scope wins and the flag
      // silently does nothing.
      ...(request.includeDeleted ? { deletedAt: undefined } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(priorityFilter ? { priority: priorityFilter } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
      ...(request.assigneeId ? { currentAssigneeId: request.assigneeId } : {}),
      ...(request.departmentId
        ? { currentDepartmentId: request.departmentId }
        : {}),
      ...(request.authorId ? { authorId: request.authorId } : {}),
      ...(search ? { OR: [{ title: search }, { description: search }] } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.ticket.findMany({ where, orderBy, skip, take }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: items.map(toTicketResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * The batch read behind the tickets DataLoader — 27-doc §1, §3.
   *
   * Reached from `Notification.data.ticketId` and from analytics drill-downs.
   *
   * **`visibilityScope` applies here exactly as it does to the list.** That is
   * the property worth stating: a batch read is still a read, and a caller with
   * no `ticket.read.all` must not be able to resolve a ticket by id that they
   * could not have listed. A batch RPC that skipped it would be a way to fetch
   * any ticket in the tenant one id at a time — which is precisely what makes
   * "it is just a simple `WHERE id IN (…)`" the dangerous framing.
   */
  async listTicketsByIds(
    request: ListTicketsByIdsRequest,
    context: CallerContext,
  ): Promise<ListTicketsByIdsResponse> {
    const { ids, overLimit } = normalizeBatchIds(request.ticketIds);

    if (overLimit) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `At most ${BATCH_ID_LIMIT} ticket ids per call`,
      });
    }

    if (ids.length === 0) return { items: [] };

    const items = await this.prisma.ticket.findMany({
      where: {
        ...tenantScope(context),
        ...this.visibilityScope(context),
        // Soft-deleted tickets ARE returned by id — 27-doc §1. A notification
        // citing a deleted ticket still has to render something, and omitting
        // it makes the edge null, which the UI cannot distinguish from a ticket
        // that never existed.
        deletedAt: undefined,
        id: { in: ids },
      },
    });

    // A SET, in the database's order. The caller aligns it to its keys.
    return { items: items.map(toTicketResponse) };
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async createTicket(
    request: CreateTicketRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const organizationId = requireTenant(context);
    const actorId = requireActor(context);

    // Defaults to the caller. An explicit `authorId` exists so an agent can
    // raise a ticket on behalf of an end user — which is exactly the case that
    // must be validated, since it is the only one where the id did not come
    // from a verified token.
    const authorId = request.authorId || actorId;
    if (authorId !== actorId) {
      await this.authReference.assertUserExists(authorId, context);
    }

    // **The dedup row and the ticket share one transaction** — 31-doc §6.2.
    // Recorded separately, a request that inserted the row and then failed
    // would make the provider's retry a no-op, losing the mail on the one
    // delivery that could still have saved it.
    //
    // No `inbound_message_id` means no transaction is needed: every other
    // transport has its own idempotency, and wrapping a single insert would be
    // ceremony.
    const ticket = request.inboundMessageId
      ? await withInboundDedup(() =>
          this.prisma.$transaction(async (tx) => {
            const created = await tx.ticket.create({
              data: this.newTicketData(organizationId, authorId, request),
            });

            await recordInboundEmail(
              tx,
              organizationId,
              request.inboundMessageId!,
              created.id,
            );

            return created;
          }),
        )
      : await this.prisma.ticket.create({
          data: this.newTicketData(organizationId, authorId, request),
        });

    // AFTER the commit, never inside it. An event announcing a ticket a later
    // rollback erases is an event no consumer can un-handle — the same rule
    // AuditPublisher and NotificationPublisher already follow.
    this.events.publish({
      pattern: TICKET_PATTERNS.created,
      organizationId,
      ticketId: ticket.id,
      occurredAt: new Date().toISOString(),
      ticketNumber: Number(ticket.ticketNumber),
      authorId: ticket.authorId,
      source: ticket.source as TicketSource,
      title: ticket.title,
    });

    return toTicketResponse(ticket);
  }

  async updateTicket(
    request: UpdateTicketRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const existing = await this.load(request.id, context);

    // An absent field means "leave unchanged". Collapsing that with an empty
    // string would make it impossible to tell "do not touch the description"
    // from "clear it".
    const data: Prisma.TicketUpdateInput = {};
    if (request.title !== undefined) data.title = request.title.trim();
    if (request.description !== undefined) {
      data.description = request.description.trim();
    }
    const priority = fromProtoTicketPriority(request.priority);
    if (priority) data.priority = priority;

    // Deliberately NO status here. Status moves through the state machine and
    // nowhere else — accepting it on a general update would be a second,
    // unvalidated path around the transition table.
    const ticket = await this.prisma.ticket.update({
      where: { id: existing.id },
      data,
    });

    return toTicketResponse(ticket);
  }

  // -------------------------------------------------------------------------
  // The state machine — one validator, five entry points
  // -------------------------------------------------------------------------

  async changeTicketStatus(
    request: ChangeTicketStatusRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const to = fromProtoTicketStatus(request.status);
    if (!to) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A target status is required',
      });
    }

    return toTicketResponse(await this.transition(request.id, to, context));
  }

  /**
   * `escalate`/`resolve`/`reopen`/`close` are the SAME operation with the
   * target fixed.
   *
   * Each is one line calling `transition`, which is the whole design: there is
   * exactly one place the transition table is consulted, so
   * `POST /tickets/:id/resolve` and `POST /tickets/:id/status {RESOLVED}`
   * cannot answer differently.
   */
  async escalateTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const ticket = await this.transition(
      request.id,
      TicketStatus.ESCALATED,
      context,
    );

    this.events.publish({
      pattern: TICKET_PATTERNS.escalated,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      ticketNumber: Number(ticket.ticketNumber),
      occurredAt: new Date().toISOString(),
      escalatedAt: (ticket.escalatedAt ?? new Date()).toISOString(),
      // The queue that must react. Domain E addresses this one by PERMISSION
      // inside the department (18-doc §3.1) — the only ticket event that does.
      departmentId: ticket.currentDepartmentId,
    });

    // Fire-and-forget, §1.7. Not awaited and its rejection is handled inside —
    // an escalation is the agent's action and must succeed on its own terms. A
    // summary that could not be generated is a missing convenience, not a
    // failed escalation.
    void this.ai.generateSummaryOnEscalation(ticket.id, context);

    return toTicketResponse(ticket);
  }

  async resolveTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(request.id, TicketStatus.RESOLVED, context),
    );
  }

  async reopenTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(request.id, TicketStatus.OPEN, context),
    );
  }

  async closeTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(request.id, TicketStatus.CLOSED, context),
    );
  }

  /**
   * Each id INDEPENDENTLY. One failing transition must not abort the other 49.
   *
   * Sequential rather than `Promise.all`, and that is a deliberate trade: fifty
   * concurrent transactions against one table would contend, and the operation
   * is an admin bulk action where a second of latency costs nothing. The
   * partial-success shape is what the caller actually needs — knowing which
   * four of fifty failed and why beats a single error naming the first.
   */
  async bulkChangeTicketStatus(
    request: BulkTicketStatusRequest,
    context: CallerContext,
  ): Promise<BulkTicketStatusResponse> {
    const ids = [...new Set(request.ticketIds)];

    if (ids.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'No ticket ids given',
      });
    }
    if (ids.length > MAX_BULK_TICKET_IDS) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `At most ${MAX_BULK_TICKET_IDS} tickets can be updated at once; received ${ids.length}`,
      });
    }

    const to = fromProtoTicketStatus(request.status);
    if (!to) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A target status is required',
      });
    }

    const updated: string[] = [];
    const failed: BulkTicketFailure[] = [];

    for (const id of ids) {
      try {
        await this.transition(id, to, context);
        updated.push(id);
      } catch (error) {
        // The REASON is carried through, not flattened to "failed": a caller
        // looking at four failures needs to know that three were already closed
        // and one belongs to another tenant.
        failed.push({ id, reason: formatErrorMsg(error) });
      }
    }

    return { updated, failed };
  }

  // -------------------------------------------------------------------------
  // Soft delete
  // -------------------------------------------------------------------------

  async deleteTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<DeleteTicketResponse> {
    const ticket = await this.load(request.id, context);

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: softDeleteData(requireActor(context)),
    });

    return {};
  }

  async restoreTicket(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    // Deliberately NOT `this.load`, which excludes soft-deleted rows — the only
    // rows this method can act on.
    const existing = await this.prisma.ticket.findFirst({
      where: {
        id: request.id,
        organizationId: requireTenant(context),
        deletedAt: { not: null },
      },
      select: { id: true },
    });
    if (!existing) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No deleted ticket with that id',
      });
    }

    // No uniqueness to re-enter, unlike Domain A's restores: a ticket has no
    // partial unique index over a soft-deletable column, so this cannot
    // conflict with a row created while it was gone.
    return toTicketResponse(
      await this.prisma.ticket.update({
        where: { id: existing.id },
        data: restoreData(),
      }),
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Reads a ticket, applies the transition table, writes, announces.
   *
   * The read and the write are NOT in a transaction, and that is a considered
   * choice rather than an omission. Two concurrent transitions would both read
   * the same `from` and both validate — but the outcome is one of two legal
   * states, and a ticket that goes OPEN -> RESOLVED -> CLOSED versus
   * OPEN -> CLOSED lands in the same place. Contrast `ticket_assignments`,
   * where a race produces two simultaneous live assignees, which is not a
   * legal state at all and is why that one has a partial unique index.
   */
  private async transition(
    ticketId: string,
    to: TicketStatus,
    context: CallerContext,
  ): Promise<Ticket> {
    const existing = await this.load(ticketId, context);
    const from = assertKnownStatus(existing.status);

    assertTransition(from, to);

    const ticket = await this.prisma.ticket.update({
      where: { id: existing.id },
      data: { status: to, ...transitionSideEffects(to) },
    });

    this.events.publish({
      pattern: TICKET_PATTERNS.statusChanged,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      ticketNumber: Number(ticket.ticketNumber),
      occurredAt: new Date().toISOString(),
      fromStatus: from,
      toStatus: to,
      changedById: context.sub,
      // Carried so Domain E does not need an RPC per notification (18-doc §3
      // test 9). A terminal transition is news for the person who opened the
      // ticket, and `changedById` is whoever closed it.
      requesterId: ticket.authorId,
    });

    return ticket;
  }

  /**
   * Both delegate to `TicketAccessService`.
   *
   * Kept as methods here rather than removed so every existing call site — and
   * `AssignmentsService`/`MessagesService`, which both call `tickets.load` —
   * stays untouched. The IMPLEMENTATION moved so `AiModule` could share it
   * without importing this module, which would have made a cycle.
   */
  private visibilityScope(context: CallerContext): Prisma.TicketWhereInput {
    return this.access.visibilityScope(context);
  }

  load(ticketId: string, context: CallerContext): Promise<Ticket> {
    return this.access.load(ticketId, context);
  }

  /** The row a new ticket is, in one place — both branches above build it. */
  private newTicketData(
    organizationId: string,
    authorId: string,
    request: CreateTicketRequest,
  ) {
    return {
      organizationId,
      authorId,
      // ASK Why should we need to trim since input is normalized in the API Gateway via DTO classes - `ticket.dto.ts`"?
      title: request.title.trim(),
      // ASK Why should we need to trim since input is normalized in the API Gateway via DTO classes - `ticket.dto.ts`"?
      description: request.description.trim(),
      source: fromProtoTicketSource(request.source) ?? TicketSource.WEB,
      priority:
        fromProtoTicketPriority(request.priority) ?? TicketPriority.MEDIUM,
      // NEW, always. A created ticket is one nobody has looked at yet, and
      // letting a client choose the initial status would let it skip triage.
      status: TicketStatus.NEW,
    };
  }
}

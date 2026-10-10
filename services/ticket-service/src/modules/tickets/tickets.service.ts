import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ListTicketsByIdsRequest,
  ListTicketsByIdsResponse,
  BulkTicketFailure,
  BulkTicketPriorityRequest,
  BulkTicketPriorityResponse,
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
  fromProtoTimestamp,
  toProtoTimestamp,
  ListTicketStatusChangesResponse,
  MarkTicketReadRequest,
  MarkTicketReadResponse,
  TicketIdRequest,
  TicketStatusActionRequest,
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
  MAX_STATUS_CHANGE_REASON_LENGTH,
  requireActor,
  requireTenant,
  restoreData,
  softDeleteData,
  TICKET_PATTERNS,
  TICKET_SORTABLE_FIELDS,
  TicketPriority,
  TicketSource,
  TERMINAL_TICKET_STATUSES,
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
  toTicketStatusChangeResponse,
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

    const unread = await this.unreadCounts(
      items.map((ticket) => ticket.id),
      context,
    );

    return {
      items: items.map((ticket) =>
        toTicketResponse(ticket, unread.get(ticket.id) ?? 0),
      ),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * The batch read behind the tickets DataLoader
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
        // Soft-deleted tickets ARE returned by id. A notification
        // citing a deleted ticket still has to render something, and omitting
        // it makes the edge null, which the UI cannot distinguish from a ticket
        // that never existed.
        deletedAt: undefined,
        id: { in: ids },
      },
    });

    // A SET, in the database's order. The caller aligns it to its keys.
    return { items: items.map((item) => toTicketResponse(item)) };
  }

  /**
   * A ticket's STATUS history, oldest first.
   *
   * Status only. Reassignments are at `ListTicketAssignments`, which carries
   * `assignedById`, `departmentId` and a `ReassignmentReason` — more than this
   * shape could, so merging the two would be one list with two meanings.
   *
   * **A non-agent sees every transition and only their own reasons.** The rest
   * come back `null` — see ADR 0023, whose rule this is.
   *
   * Unpaginated, on the same bound the assignment history accepts: the length
   * is set by agent action rather than by anything a customer can drive.
   *
   * @throws RpcException NOT_FOUND when the ticket is not visible to the
   *   caller — the scoped `load` is what makes this a ticket sub-resource
   *   rather than a second way into an admin log.
   */
  async listTicketStatusChanges(
    request: TicketIdRequest,
    context: CallerContext,
  ): Promise<ListTicketStatusChangesResponse> {
    const ticket = await this.load(request.id, context);

    const rows = await this.prisma.ticketStatusChange.findMany({
      where: { ticketId: ticket.id },
      // Oldest first: this is a path, and a path reads forwards. Every other
      // list in this system is newest-first because those are feeds.
      orderBy: { changedAt: 'asc' },
    });

    // The reason is written BY an agent FOR agents — "duplicate of #4127,
    // customer keeps reopening" is the shape it takes — and `visibilityScope`
    // makes the ticket's AUTHOR a reader of this list. Internal notes exist
    // because agents need somewhere the customer cannot see (ADR 0023); this
    // column is that same need on a different table, and it had no equivalent.
    //
    // Their own survives: `/escalate` is the one transition an END_USER can
    // reach, and reading back words they wrote is not a disclosure.
    //
    // A post-fetch map rather than the query fragment `internalNoteScope` uses,
    // and the difference is what is being hidden. That one drops ROWS, so
    // filtering afterwards would leak their existence through the count. This
    // nulls a FIELD on rows the caller sees either way — nothing about the
    // count or the timing changes.
    if (this.access.isAgent(context)) {
      return { items: rows.map(toTicketStatusChangeResponse) };
    }

    const actorId = requireActor(context);

    return {
      items: rows.map((row) =>
        toTicketStatusChangeResponse(
          row.changedById === actorId ? row : { ...row, reason: null },
        ),
      ),
    };
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

    // **The dedup row and the ticket share one transaction**.
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
    assertNotTerminal(to);

    return toTicketResponse(
      await this.transition(request.id, to, context, request.reason),
    );
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
    request: TicketStatusActionRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    const ticket = await this.transition(
      request.ticketId,
      TicketStatus.ESCALATED,
      context,
      request.reason,
    );

    this.events.publish({
      pattern: TICKET_PATTERNS.escalated,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      ticketNumber: Number(ticket.ticketNumber),
      occurredAt: new Date().toISOString(),
      escalatedAt: (ticket.escalatedAt ?? new Date()).toISOString(),
      // The queue that must react. Domain E addresses this one by PERMISSION
      // inside the department — the only ticket event that does.
      departmentId: ticket.currentDepartmentId,
    });

    // Fire-and-forget. Not awaited and its rejection is handled inside —
    // an escalation is the agent's action and must succeed on its own terms. A
    // summary that could not be generated is a missing convenience, not a
    // failed escalation.
    void this.ai.generateSummaryOnEscalation(ticket.id, context);

    return toTicketResponse(ticket);
  }

  async resolveTicket(
    request: TicketStatusActionRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(
        request.ticketId,
        TicketStatus.RESOLVED,
        context,
        request.reason,
      ),
    );
  }

  async reopenTicket(
    request: TicketStatusActionRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(
        request.ticketId,
        TicketStatus.OPEN,
        context,
        request.reason,
      ),
    );
  }

  async closeTicket(
    request: TicketStatusActionRequest,
    context: CallerContext,
  ): Promise<TicketResponse> {
    return toTicketResponse(
      await this.transition(
        request.ticketId,
        TicketStatus.CLOSED,
        context,
        request.reason,
      ),
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
    const ids = this.bulkIds(request.ticketIds);

    const to = fromProtoTicketStatus(request.status);
    if (!to) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A target status is required',
      });
    }
    // BEFORE the loop, and thrown rather than recorded per item: the target is
    // one value for the whole request, so it is the request that is refused
    // and not fifty individual tickets.
    assertNotTerminal(to);

    return this.bulkApply(ids, (id) =>
      this.transition(id, to, context, request.reason),
    );
  }

  /**
   * Applies `priority` to each id INDEPENDENTLY.
   *
   * Priority has no state machine — any value to any value — so every failure
   * here is a ticket the caller cannot see or that no longer exists, never an
   * illegal move.
   *
   * @throws RpcException INVALID_ARGUMENT for an empty list, a list over
   *   {@link MAX_BULK_TICKET_IDS}, or an unset priority.
   */
  async bulkChangeTicketPriority(
    request: BulkTicketPriorityRequest,
    context: CallerContext,
  ): Promise<BulkTicketPriorityResponse> {
    const ids = this.bulkIds(request.ticketIds);

    const priority = fromProtoTicketPriority(request.priority);
    if (!priority) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A target priority is required',
      });
    }

    return this.bulkApply(ids, async (id) => {
      // Through the same scoped load every singular write uses, so an id the
      // caller cannot see fails as NOT_FOUND rather than updating a row.
      const existing = await this.load(id, context);
      await this.prisma.ticket.update({
        where: { id: existing.id },
        data: { priority },
      });
    });
  }

  /**
   * Marks this ticket's thread read up to the point the caller names.
   *
   * `readAt` is the `created_at` of the newest message the client rendered.
   * Absent falls back to `now()`, which is right for a client with nothing on
   * screen.
   *
   * @throws RpcException NOT_FOUND when the ticket is not visible to the caller.
   */
  async markTicketRead(
    request: MarkTicketReadRequest,
    context: CallerContext,
  ): Promise<MarkTicketReadResponse> {
    const ticket = await this.load(request.ticketId, context);
    const userId = requireActor(context);

    // CLAMPED, never trusted past `now()`: a client with a clock running fast
    // would otherwise mark messages read before they were written, and the
    // badge would stay at zero through a whole conversation. `Math.min` on the
    // epoch rather than a comparison, so the fallback and the clamp are one
    // expression.
    const claimed = fromProtoTimestamp(request.readAt) ?? new Date();
    const lastReadAt = new Date(Math.min(claimed.getTime(), Date.now()));

    // MONOTONIC, and raw because Prisma cannot put `GREATEST` in an `upsert`.
    // ticket-service already writes SQL for this reason — `ticket-rollup.job.ts`
    // does it "rather than as a read-modify-write loop", which is the same
    // trade: one statement that cannot race with itself.
    //
    // Last-write-wins was the alternative and it does not need two tabs to go
    // wrong. A thread view that fires this on render has two requests in flight
    // whenever a message lands mid-render; if they reorder, the earlier stamp
    // wins and the badge reappears on the most ordinary client there is.
    //
    // `$queryRaw` and `RETURNING`, never `$executeRaw`: `GREATEST` can decline
    // the input, so the stored value and the claimed one diverge — which is the
    // whole point — and `last_read_at` on the response exists to disclose
    // exactly that. A row count would leave it reporting the claim.
    //
    // The cost, stated: raw SQL puts these table and column names outside the
    // compiler's reach, so a Prisma rename breaks this at runtime rather than
    // at build. The rollup accepts that trade and so does this.
    const [stored] = await this.prisma.$queryRaw<[{ last_read_at: Date }]>`
      INSERT INTO ticket_read_states (ticket_id, user_id, organization_id, last_read_at)
      VALUES (${ticket.id}::uuid, ${userId}::uuid, ${ticket.organizationId}::uuid, ${lastReadAt})
      ON CONFLICT (ticket_id, user_id) DO UPDATE
        SET last_read_at = GREATEST(EXCLUDED.last_read_at, ticket_read_states.last_read_at)
      RETURNING last_read_at
    `;

    return { lastReadAt: toProtoTimestamp(stored.last_read_at) };
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
    reason?: string,
  ): Promise<Ticket> {
    const existing = await this.load(ticketId, context);
    const from = assertKnownStatus(existing.status);

    assertTransition(from, to);

    const trimmedReason = assertReasonLength(reason);

    // ONE transaction, and that is the difference between this history and the
    // event below it. `ticket.status_changed` is fire-and-forget, so a history
    // assembled from it loses a row whenever the broker is down — acceptable
    // for an admin trail, not for a screen showing a customer what happened to
    // their ticket.
    const [ticket] = await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: existing.id },
        data: { status: to, ...transitionSideEffects(to) },
      }),
      this.prisma.ticketStatusChange.create({
        data: {
          ticketId: existing.id,
          organizationId: existing.organizationId,
          fromStatus: from,
          toStatus: to,
          // `requireActor` rather than `context.sub ?? null`: `load` above has
          // already been through `tenantScope`, which refuses a caller with no
          // identity, so a null here would be unreachable defensive code that
          // reads as a supported case.
          changedById: requireActor(context),
          reason: trimmedReason,
        },
      }),
    ]);

    this.events.publish({
      pattern: TICKET_PATTERNS.statusChanged,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      ticketNumber: Number(ticket.ticketNumber),
      occurredAt: new Date().toISOString(),
      fromStatus: from,
      toStatus: to,
      changedById: context.sub,
      // Carried so Domain E does not need an RPC per notification (
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
      title: request.title.trim(),
      description: request.description.trim(),
      source: fromProtoTicketSource(request.source) ?? TicketSource.WEB,
      priority:
        fromProtoTicketPriority(request.priority) ?? TicketPriority.MEDIUM,
      // NEW, always. A created ticket is one nobody has looked at yet, and
      // letting a client choose the initial status would let it skip triage.
      status: TicketStatus.NEW,
    };
  }

  /** Deduplicated, and refused when empty or over the cap. */
  private bulkIds(ticketIds: string[]): string[] {
    const ids = [...new Set(ticketIds)];

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

    return ids;
  }

  /**
   * Runs `apply` over each id, collecting successes and failures separately.
   *
   * Sequential rather than `Promise.all`, and that is a deliberate trade: fifty
   * concurrent transactions against one table would contend, and the operation
   * is an admin bulk action where a second of latency costs nothing.
   */
  private async bulkApply(
    ids: string[],
    apply: (id: string) => Promise<unknown>,
  ): Promise<{ updated: string[]; failed: BulkTicketFailure[] }> {
    const updated: string[] = [];
    const failed: BulkTicketFailure[] = [];

    for (const id of ids) {
      try {
        await apply(id);
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

  /**
   * Unread message counts for a PAGE of tickets, in one query.
   *
   * The reason the read cursor is a feature rather than a table: a queue screen
   * showing 25 rows cannot mean 25 count requests, so this is one grouped count
   * over the page's ids rather than a per-ticket lookup.
   *
   * A ticket the caller never opened has no `ticket_read_states` row, and its
   * unread count is EVERYTHING — hence `lastReadAt: null` being a match rather
   * than a skip. Getting that backwards makes every untouched ticket read as
   * caught-up, which is the failure a badge exists to prevent.
   *
   * @returns ticket id -> count, with absent meaning zero.
   */
  private async unreadCounts(
    ticketIds: string[],
    context: CallerContext,
  ): Promise<Map<string, number>> {
    const userId = context.sub;
    // A caller with no identity cannot have read anything, and `tenantScope`
    // has already refused them upstream — this is the type narrowing, not a
    // second check.
    if (ticketIds.length === 0 || !userId) return new Map();

    const readStates = await this.prisma.ticketReadState.findMany({
      where: { userId, ticketId: { in: ticketIds } },
      select: { ticketId: true, lastReadAt: true },
    });
    const watermark = new Map(
      readStates.map((row) => [row.ticketId, row.lastReadAt]),
    );

    const grouped = await this.prisma.ticketMessage.groupBy({
      by: ['ticketId'],
      where: {
        ticketId: { in: ticketIds },
        // Their own messages never count, or sending one would make the
        // sender's own ticket unread.
        NOT: { senderId: userId },
        // The SAME fragment the thread read uses, not `isInternalNote: false`
        // spelled again: a badge counting notes the caller cannot open shows an
        // unread count they can never clear, and a second copy of the rule is
        // how the two drift.
        ...this.access.internalNoteScope(context),
        // Redacted messages never count, and the ASYMMETRY is why this is a
        // decision rather than a preference. `redactedAt` does not touch
        // `createdAt`, so a message redacted AFTER someone read it stays under
        // their watermark and never returns. The badge could therefore only
        // rise for a message redacted BEFORE it was read — which is exactly the
        // case where the redaction was protecting that reader.
        //
        // Counting them would not "sometimes surface a redaction". It would
        // surface precisely the ones meant to reach nobody, to the one person
        // they were kept from, and never the harmless ones. The badge promises
        // unread CONTENT, and a placeholder is not content.
        redactedAt: null,
        // One branch per ticket ON THIS PAGE, so the count is the page size and
        // nothing else — `toPrismaPage` runs `clampLimit`, which caps it at
        // `DEFAULT_SEARCH.MAX_LIMIT` (100). It does not grow with the tenant,
        // which is the thing a reader seeing a generated `OR` will wonder.
        //
        // The alternative is one raw query with a LEFT JOIN on the read states,
        // trading two round trips for one — declined because it needs
        // `internalNoteScope` as a string, which is the copy this whole design
        // avoids.
        OR: ticketIds.map((ticketId) => {
          const lastReadAt = watermark.get(ticketId);
          return lastReadAt
            ? { ticketId, createdAt: { gt: lastReadAt } }
            : { ticketId };
        }),
      },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.ticketId, row._count._all]));
  }
}

/**
 * Refuses a terminal target on the GENERIC status entry points.
 *
 * @throws RpcException FAILED_PRECONDITION when `to` is `RESOLVED` or `CLOSED`.
 */
function assertNotTerminal(to: TicketStatus): void {
  // `/resolve` and `/close` require `ticket.resolve`; the generic route and its
  // bulk form require `ticket.update`. Without this, either reaches the same
  // `transition()` behind the weaker gate — which is exactly what the comment
  // above the four convenience routes says splitting them prevents.
  //
  // Refused rather than permission-checked: the permission lives on the
  // decorator, and a service that resolved it per target would leave every
  // decorator in this family describing something other than its route.
  //
  // Here and not in `transition()`: `/resolve` and `/close` call that directly
  // and are the sanctioned way to reach these two states.
  if (!TERMINAL_TICKET_STATUSES.includes(to)) return;

  throw new RpcException({
    code: status.FAILED_PRECONDITION,
    message: `Use the ${to === TicketStatus.RESOLVED ? 'resolve' : 'close'} route to move a ticket to ${to}`,
  });
}

/**
 * Trims a status-change reason and refuses one over the bound.
 *
 * @returns the trimmed reason, or `undefined` when absent or blank.
 * @throws RpcException INVALID_ARGUMENT when it exceeds
 *   {@link MAX_STATUS_CHANGE_REASON_LENGTH}.
 */
function assertReasonLength(reason: string | undefined): string | undefined {
  // Bounded HERE as well as on the DTO, for the reason `MAX_BULK_TICKET_IDS`
  // gives: this service is reachable from other services over gRPC, where no
  // `ValidationPipe` ever ran. The column is `Text`, so nothing below would
  // refuse a megabyte.
  const trimmed = reason?.trim();
  if (!trimmed) return undefined;

  if (trimmed.length > MAX_STATUS_CHANGE_REASON_LENGTH) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `A status-change reason cannot exceed ${MAX_STATUS_CHANGE_REASON_LENGTH} characters`,
    });
  }

  return trimmed;
}

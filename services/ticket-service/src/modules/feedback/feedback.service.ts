import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  emptyPage,
  FeedbackResponse,
  fromProtoTimestamp,
  ListFeedbackRequest,
  ListFeedbackResponse,
  SubmitFeedbackRequest,
  toPageMeta,
  toPrismaPage,
  toSearchFilter,
  toProtoTimestamp,
  GetFeedbackRequest,
  GetFeedbackResponse,
  ListCitedDocumentFeedbackRequest,
  ListCitedDocumentFeedbackResponse,
  WithdrawFeedbackRequest,
  WithdrawFeedbackResponse,
} from '@synapsedesk/grpc-proto';
import {
  FEEDBACK_RATINGS,
  FEEDBACK_SORTABLE_FIELDS,
  FeedbackRating,
  MAX_MESSAGE_CONTENT_LENGTH,
} from '@synapsedesk/contracts';
import {
  parseAnalyticsRange,
  requireActor,
  requireTenant,
} from '@synapsedesk/nest-common';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { AiResponseFeedback, Prisma } from '../../generated/prisma/client';

/** The rated message's ticket, as a feedback row names it. */
type RatedTicket = { id: string; ticketNumber: bigint };

function toFeedbackResponse(
  feedback: AiResponseFeedback,
  ticket: RatedTicket | undefined,
): FeedbackResponse {
  return {
    id: feedback.id,
    ticketMessageId: feedback.ticketMessageId,
    userId: feedback.userId,
    organizationId: feedback.organizationId,
    rating: feedback.rating,
    feedbackText: feedback.feedbackText ?? undefined,
    citationAccurate: feedback.citationAccurate ?? undefined,
    createdAt: toProtoTimestamp(feedback.createdAt),
    updatedAt: toProtoTimestamp(feedback.updatedAt),
    ticketId: ticket?.id,
    ticketNumber: ticket ? Number(ticket.ticketNumber) : undefined,
  };
}

/**
 * Thumbs on AI replies — the signal that tells Domain C whether the model helps.
 *
 * The whole module turns on one schema fact: `(ticket_message_id, user_id)` is
 * unique. That makes submitting an UPSERT rather than an insert, and the
 * difference is not cosmetic — a user who changes their mind from 👍 to 👎 must
 * end up counted once, with the later opinion. Appending would double-count
 * them in every quality metric and, worse, would make the metric drift further
 * from the truth the more engaged the user was.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly authReference: AuthReferenceService,
  ) {}

  /**
   * Submit, or change your mind.
   *
   * Scoped through the MESSAGE's ticket, not merely by message id: feedback
   * rows carry a denormalized `organization_id`, and taking it from the caller
   * without checking they can see the message would let somebody stamp their
   * own tenant onto a row about another tenant's conversation.
   */
  async submitFeedback(
    request: SubmitFeedbackRequest,
    context: CallerContext,
  ): Promise<FeedbackResponse> {
    const organizationId = requireTenant(context);
    const userId = requireActor(context);
    const rating = this.requireRating(request.rating);
    const feedbackText = this.normalizeText(request.feedbackText);

    const ticket = await this.assertMessageVisible(
      request.ticketMessageId,
      context,
    );

    const feedback = await this.prisma.aiResponseFeedback.upsert({
      where: {
        ticketMessageId_userId: {
          ticketMessageId: request.ticketMessageId,
          userId,
        },
      },
      create: {
        ticketMessageId: request.ticketMessageId,
        userId,
        organizationId,
        rating,
        feedbackText,
        citationAccurate: request.citationAccurate ?? null,
      },
      // `organizationId` and `userId` are deliberately NOT updatable — they
      // identify the row, and letting an update move either would let a resubmit
      // re-home somebody else's feedback.
      update: {
        rating,
        feedbackText,
        citationAccurate: request.citationAccurate ?? null,
      },
    });

    return toFeedbackResponse(feedback, ticket);
  }

  /**
   * The CALLER's rating on one message, or nothing.
   *
   * The client asks this for every AI message it renders, so "not rated" is the
   * common answer and comes back as an absent field rather than `NOT_FOUND` —
   * a 404 per unrated message would turn the ordinary state into an error log.
   *
   * Read through the MESSAGE, not by feedback id: the row is reachable through
   * a message, and a read that started at `ai_response_feedbacks` would inherit
   * none of the ticket's visibility filter.
   *
   * @throws RpcException NOT_FOUND when the message is not visible to the
   *   caller — which is the same answer as "no such message", deliberately.
   */
  async getFeedback(
    request: GetFeedbackRequest,
    context: CallerContext,
  ): Promise<GetFeedbackResponse> {
    const userId = requireActor(context);

    const ticket = await this.assertMessageVisible(
      request.ticketMessageId,
      context,
    );

    const feedback = await this.prisma.aiResponseFeedback.findUnique({
      where: {
        ticketMessageId_userId: {
          ticketMessageId: request.ticketMessageId,
          userId,
        },
      },
    });

    // The tenant check that `assertMessageVisible` cannot make: it proved the
    // MESSAGE is the caller's to see, and this row is keyed on (message, user).
    // Both are already theirs, so a mismatch here would mean the row was
    // re-homed — which `submitFeedback`'s update deliberately cannot do.
    if (feedback?.organizationId !== requireTenant(context)) {
      return {};
    }

    return { feedback: toFeedbackResponse(feedback, ticket) };
  }

  /**
   * Withdraw — only ever the CALLER'S OWN.
   *
   * The `where` names both the message and the caller, so there is no code path
   * that could delete somebody else's opinion even if a caller supplied another
   * user's id: there is nowhere to supply one.
   */
  async withdrawFeedback(
    request: WithdrawFeedbackRequest,
    context: CallerContext,
  ): Promise<WithdrawFeedbackResponse> {
    const userId = requireActor(context);

    const existing = await this.prisma.aiResponseFeedback.findUnique({
      where: {
        ticketMessageId_userId: {
          ticketMessageId: request.ticketMessageId,
          userId,
        },
      },
      select: { id: true, organizationId: true },
    });

    // NOT_FOUND both when nothing exists and when it belongs to another tenant.
    if (existing?.organizationId !== requireTenant(context)) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'You have not left feedback on that message',
      });
    }

    // A hard delete, unlike almost everything else in this codebase. Withdrawn
    // feedback must stop counting, and a soft-deleted row that every aggregate
    // then had to remember to exclude would be a filter waiting to be forgotten
    // in one query. There is also nothing here worth an audit trail — the row
    // is one user's opinion about a machine.
    await this.prisma.aiResponseFeedback.delete({ where: { id: existing.id } });

    return {};
  }

  /**
   * The ratings of AI answers since `since`, per document the answers cited.
   *
   * For ingestion-service's `NEGATIVE_FEEDBACK` detection, which calls it as
   * the system. **No caller check, deliberately:** the tenant is a field of
   * the request, as on the ledger's RPCs, because a system caller has no user
   * to read it from. What protects it is that it's service-to-service only and
   * never routed by the gateway.
   *
   * Each rating counts once per DOCUMENT its answer cited, however many of
   * the document's passages it cited. "Citation inaccurate" is a mark on the
   * answer, so it counts against every document the answer cited.
   *
   * @throws RpcException INVALID_ARGUMENT without `organizationId` or
   *   `since`.
   */
  async listCitedDocumentFeedback(
    request: ListCitedDocumentFeedbackRequest,
  ): Promise<ListCitedDocumentFeedbackResponse> {
    const { organizationId } = request;
    const since = fromProtoTimestamp(request.since);
    if (!organizationId || !since) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: '`organizationId` and `since` are required',
      });
    }

    const rows = await this.prisma.$queryRaw<
      {
        document_id: string;
        ratings: number;
        downvotes: number;
        inaccurate: number;
      }[]
    >`
      SELECT cited.document_id,
             count(*)::int AS ratings,
             count(*) FILTER (WHERE f.rating = -1)::int
               AS downvotes,
             count(*) FILTER (WHERE f.citation_accurate = false)::int
               AS inaccurate
      FROM ai_response_feedbacks f
      JOIN ticket_messages m ON m.id = f.ticket_message_id
      CROSS JOIN LATERAL (
        SELECT DISTINCT citation ->> 'documentId' AS document_id
        FROM jsonb_array_elements(m.citations) AS citation
      ) cited
      WHERE f.organization_id = ${organizationId}::uuid
        AND f.updated_at >= ${since}
        AND jsonb_typeof(m.citations) = 'array'
      GROUP BY cited.document_id
    `;

    return {
      items: rows.map((row) => ({
        documentId: row.document_id,
        ratings: row.ratings,
        downvotes: row.downvotes,
        inaccurate: row.inaccurate,
      })),
    };
  }

  /**
   * The tenant's feedback stream, for quality review.
   *
   * Scoped on the DENORMALIZED `organization_id` rather than joined back
   * through message -> ticket. That column exists precisely so this query stays
   * one index scan: a quality dashboard reads it constantly and a three-table
   * join per page would be the slowest thing in the service.
   */
  async listFeedback(
    request: ListFeedbackRequest,
    context: CallerContext,
  ): Promise<ListFeedbackResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      FEEDBACK_SORTABLE_FIELDS,
    );

    const from = fromProtoTimestamp(request.from);
    const to = fromProtoTimestamp(request.to);
    // The same range limit as every analytics read: a dashboard's list can't
    // show a longer window than its charts. Checked on the calendar days the
    // two instants fall on.
    if (from && to) {
      parseAnalyticsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
        await this.authReference.getAnalyticsRangeDays(context),
      );
    }

    // `?searchTerm=` was advertised on this route and honoured by nobody
    // (known-gaps #6). `feedbackText` is the only free-text column, and it is
    // NULLABLE — a rating left without a comment simply does not match, which
    // is correct: a text search is a question about text.
    const search = toSearchFilter(page.searchTerm);

    const where: Prisma.AiResponseFeedbackWhereInput = {
      organizationId: requireTenant(context),
      ...(search ? { feedbackText: search } : {}),
      // 0 is the proto zero value and means "no filter" — unambiguous here
      // because the only legal ratings are 1 and -1.
      ...(request.rating ? { rating: this.requireRating(request.rating) } : {}),
      ...(request.citationAccurate !== undefined
        ? { citationAccurate: request.citationAccurate }
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              // `lte`, not `lt`: a caller asking for "up to the 5th" means the
              // whole of the 5th, and `lt` would silently drop that day.
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.aiResponseFeedback.findMany({ where, orderBy, skip, take }),
      this.prisma.aiResponseFeedback.count({ where }),
    ]);

    const tickets = await this.ticketsOf(items);

    return {
      items: items.map((item) =>
        toFeedbackResponse(item, tickets.get(item.ticketMessageId)),
      ),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  // -------------------------------------------------------------------------

  /**
   * `{1, -1}` — a thumb, not a scale.
   *
   * Checked here AND by a Postgres CHECK the seeder applies. Two layers because
   * Prisma expresses neither natively: this one gives the caller a usable error,
   * that one stops a bad row entering through a migration or a psql session.
   */
  private requireRating(rating: number): FeedbackRating {
    if (!FEEDBACK_RATINGS.includes(rating as FeedbackRating)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `A rating must be one of ${FEEDBACK_RATINGS.join(' or ')}`,
      });
    }

    return rating as FeedbackRating;
  }

  private normalizeText(text?: string): string | null {
    const trimmed = text?.trim();
    if (!trimmed) return null;

    if (trimmed.length > MAX_MESSAGE_CONTENT_LENGTH) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Feedback cannot exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
      });
    }

    return trimmed;
  }

  /**
   * "May this caller see the message they are rating?"
   *
   * `ticket_messages` has no tenant column, so the answer only exists one hop
   * up — and an internal note the caller cannot read must not be ratable
   * either, which is why this reuses the ticket visibility check rather than
   * merely confirming the message row exists.
   */
  /**
   * Each rated message's ticket, by message id, in one read. The row has no
   * relation to its message (the message may be redacted or gone), so this is
   * a lookup, and a missing message leaves its row without a ticket.
   */
  private async ticketsOf(
    items: AiResponseFeedback[],
  ): Promise<Map<string, RatedTicket>> {
    const messages = await this.prisma.ticketMessage.findMany({
      where: { id: { in: items.map((item) => item.ticketMessageId) } },
      select: {
        id: true,
        ticket: { select: { id: true, ticketNumber: true } },
      },
    });
    return new Map(messages.map((message) => [message.id, message.ticket]));
  }

  private async assertMessageVisible(
    ticketMessageId: string,
    context: CallerContext,
  ): Promise<RatedTicket> {
    const message = await this.prisma.ticketMessage.findUnique({
      where: { id: ticketMessageId },
      select: { ticketId: true, isInternalNote: true },
    });

    if (!message || (message.isInternalNote && !this.access.isAgent(context))) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No message with that id',
      });
    }

    // Throws NOT_FOUND if the ticket is another tenant's or not theirs to see.
    return this.access.load(message.ticketId, context);
  }
}

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
  toProtoTimestamp,
  WithdrawFeedbackRequest,
  WithdrawFeedbackResponse,
} from '@synapsedesk/grpc-proto';
import {
  FEEDBACK_RATINGS,
  FEEDBACK_SORTABLE_FIELDS,
  FeedbackRating,
  MAX_MESSAGE_CONTENT_LENGTH,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { AiResponseFeedback, Prisma } from '../../generated/prisma/client';

function toFeedbackResponse(feedback: AiResponseFeedback): FeedbackResponse {
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

    await this.assertMessageVisible(request.ticketMessageId, context);

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

    return toFeedbackResponse(feedback);
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

    const where: Prisma.AiResponseFeedbackWhereInput = {
      organizationId: requireTenant(context),
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

    return {
      items: items.map(toFeedbackResponse),
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
  private async assertMessageVisible(
    ticketMessageId: string,
    context: CallerContext,
  ): Promise<void> {
    const message = await this.prisma.ticketMessage.findUnique({
      where: { id: ticketMessageId },
      select: { ticketId: true, isInternalNote: true },
    });

    if (!message || (message.isInternalNote && !this.isAgent(context))) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No message with that id',
      });
    }

    // Throws NOT_FOUND if the ticket is another tenant's or not theirs to see.
    await this.access.load(message.ticketId, context);
  }

  private isAgent(context: CallerContext): boolean {
    return (
      context.isSuperAdmin ||
      context.permissionCodes.includes('ticket.read.all') ||
      context.permissionCodes.includes('ticket.message.moderate')
    );
  }
}

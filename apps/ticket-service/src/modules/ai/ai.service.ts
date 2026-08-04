import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AiSummaryResponse,
  CallerContext,
  ClassifyTicketResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  GetSuggestionsResponse,
  ListSimilarTicketsResponse,
  TicketAiRequest,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { RagClientService } from '../ai-client/rag-client.service';
import { AiSummary } from '../../generated/prisma/client';

function toAiSummaryResponse(summary: AiSummary): AiSummaryResponse {
  return {
    id: summary.id,
    ticketId: summary.ticketId,
    summaryText: summary.summaryText,
    suggestedAction: summary.suggestedAction,
    confidenceScore: summary.confidenceScore,
    modelName: summary.modelName,
    createdAt: toTimestamp(summary.createdAt),
    updatedAt: toTimestamp(summary.updatedAt),
  };
}

/**
 * The AI co-pilot — contract-first, per §1.7.
 *
 * `rag-service` is Python and is not started, so every generation call answers
 * UNAVAILABLE today. What is REAL here and worth building now:
 *
 *   - the tenant + visibility check in front of every RPC
 *   - the `ai_summaries` upsert, which is a 1:1 relation and must stay one
 *   - `GetSummary`, which reads a row and needs no model at all
 *
 * Those three are where the bugs would be, and none of them depends on a model
 * existing. When Domain C lands, this file changes at the `rag` calls and
 * nowhere else.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly rag: RagClientService,
  ) {}

  /**
   * The stored summary, or NOT_FOUND.
   *
   * 404 rather than an empty object, and §2.6 asks for exactly this. "No
   * summary has been generated" and "the summary is blank" are different facts,
   * and a client that got `{}` for the first would render an empty summary
   * panel instead of a "generate" button.
   */
  async getSummary(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<AiSummaryResponse> {
    const ticket = await this.access.load(request.ticketId, context);

    const summary = await this.prisma.aiSummary.findUnique({
      where: { ticketId: ticket.id },
    });
    if (!summary) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No summary has been generated for this ticket yet',
      });
    }

    return toAiSummaryResponse(summary);
  }

  /**
   * Generate and store — an UPSERT on a 1:1 relation.
   *
   * `upsert`, not `create`, because `ai_summaries.ticket_id` is unique: a
   * second `create` would throw, and re-generating after the thread has moved
   * on is the normal case rather than the exception. Appending instead would
   * leave two summaries of the same ticket with no way to tell which describes
   * the conversation as it stands.
   */
  async generateSummary(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<AiSummaryResponse> {
    const ticket = await this.access.load(request.ticketId, context);

    // Throws UNAVAILABLE while rag-service is absent — BEFORE any write, so a
    // failed generation never leaves a half-written summary behind.
    const draft = await this.rag.generateSummary();

    const summary = await this.prisma.aiSummary.upsert({
      where: { ticketId: ticket.id },
      create: {
        ticketId: ticket.id,
        summaryText: draft.summaryText,
        suggestedAction: draft.suggestedAction,
        confidenceScore: draft.confidenceScore,
        modelName: draft.modelName,
      },
      update: {
        summaryText: draft.summaryText,
        suggestedAction: draft.suggestedAction,
        confidenceScore: draft.confidenceScore,
        modelName: draft.modelName,
      },
    });

    return toAiSummaryResponse(summary);
  }

  /**
   * The escalation hook — §1.7's fire-and-forget rule.
   *
   * Escalating a ticket is the agent's action and must succeed on its own
   * terms. A summary that could not be generated is a missing convenience, not
   * a failed escalation, so this swallows everything and logs. Today it always
   * fails, which makes the guarantee easy to verify and easy to forget: the
   * test for it is written against the failing path deliberately.
   *
   * Returns void and is never awaited by the caller for its RESULT — only to
   * keep the rejection inside this method.
   */
  async generateSummaryOnEscalation(
    ticketId: string,
    context: CallerContext,
  ): Promise<void> {
    if (!this.rag.isAvailable) {
      this.logger.debug(
        `Escalation summary skipped for ticket ${ticketId}: rag-service is not configured`,
      );
      return;
    }

    try {
      await this.generateSummary({ ticketId }, context);
    } catch (error) {
      this.logger.error(
        `Escalation summary failed for ticket ${ticketId}: ${formatErrorMsg(error)}`,
      );
    }
  }

  /**
   * A draft reply. Deliberately does NOT persist a message.
   *
   * The agent is meant to read it, edit it and decide — persisting here would
   * put an unreviewed generated message into the customer-visible thread.
   * `POST /tickets/:id/messages` with `invokeAi` is the path that does persist,
   * and it is a different, explicit choice.
   */
  async generateDraft(
    request: GenerateDraftRequest,
    context: CallerContext,
  ): Promise<GenerateDraftResponse> {
    await this.access.load(request.ticketId, context);

    const draft = await this.rag.generateReplyDraft();

    return {
      content: draft.content,
      modelName: draft.modelName,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    };
  }

  async getSuggestions(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<GetSuggestionsResponse> {
    await this.access.load(request.ticketId, context);

    return { items: await this.rag.getSuggestions() };
  }

  async classifyTicket(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<ClassifyTicketResponse> {
    await this.access.load(request.ticketId, context);

    // A SUGGESTION, never applied here. Auto-routing on a model's guess without
    // an agent confirming it would move tickets between teams on a confidence
    // score nobody looked at.
    return this.rag.classifyTicket();
  }

  async listSimilarTickets(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<ListSimilarTicketsResponse> {
    await this.access.load(request.ticketId, context);

    return { items: await this.rag.listSimilarTickets() };
  }
}

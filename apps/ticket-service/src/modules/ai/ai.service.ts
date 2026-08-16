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
  ConversationTurn,
  TicketAiRequest,
  toProtoTimestamp,
  toProtoTicketPriority,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';
import { isDraftRefusal } from '../ai-client/refusal';
import { PrismaService } from '../prisma/prisma.service';
import { AiAttachmentService } from '../ai-attachments/ai-attachment.service';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { RagClientService } from '../ai-client/rag-client.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { AiSummary } from '../../generated/prisma/client';

/**
 * How many messages a generation prompt carries.
 *
 * Bounded because a 300-message thread is prompt tokens charged on every draft
 * — and the tail is what a reply is actually answering. Generous enough that a
 * normal support conversation fits whole.
 */
const TRANSCRIPT_TURNS = 40;

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
    private readonly authReference: AuthReferenceService,
    private readonly aiAttachments: AiAttachmentService,
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

    // BEFORE any write, so a failed generation never leaves a half-written
    // summary behind — and at the cap this is where the 402 comes from.
    const draft = await this.rag.generateSummary(
      ticket.id,
      await this.transcript(ticket.id),
      context,
      // MANUAL. A discretionary summary refuses at the cap like everything
      // else; the escalation path below is the one exemption (RDM §1.14).
      false,
    );

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
      await this.summarize(ticketId, context, { triggeredByEscalation: true });
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
    const ticket = await this.access.load(request.ticketId, context);

    // The customer's last message may carry a screenshot, and this is the
    // surface replying to it — 36-doc §2. Filtered from the row before anything
    // is downloaded, so an attached zip costs nothing.
    const attachments = await this.aiAttachments.forLastUserMessage(
      ticket.id,
      context,
    );

    let draft: Awaited<ReturnType<RagClientService['generateReplyDraft']>>;
    try {
      draft = await this.rag.generateReplyDraft(
        ticket.id,
        await this.transcript(ticket.id),
        context,
        undefined,
        attachments.parts,
      );
    } catch (error) {
      // **The write-back, on the refusal path only** — 36-doc §7. The message
      // that was just refused must not reach the NEXT draft's transcript;
      // without this the guard refuses the same question every time an agent
      // presses the button, which makes the refusal a delay rather than a
      // defence.
      //
      // Rethrown either way: the agent still gets the refusal. This records it.
      await this.excludeRefused(ticket.id, error);
      throw error;
    }

    return {
      content: draft.content,
      modelName: draft.modelName,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
      // **Returned so the acceptance loop can close.** The client hands this
      // back as `generatedFromId` when the agent posts; without it the outcome
      // is never written, the hourly sweep marks the draft DISCARDED, and
      // acceptance rate counts a sent draft as ignored — understating the one
      // number that justifies the co-pilot.
      generationId: draft.generationId,
      citations: draft.citations.map((citation) => ({
        chunkId: citation.chunkId,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        pageNumber: citation.pageNumber ?? undefined,
      })),
    };
  }

  async getSuggestions(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<GetSuggestionsResponse> {
    // **Bound rather than discarded.** This call was already here as the access
    // check and threw its result away; the article sidebar needs the ticket's
    // subject as its retrieval query — 39-doc §3 — so the change is a variable,
    // not a second fetch.
    const ticket = await this.access.load(request.ticketId, context);

    const suggestions = await this.rag.getSuggestions(
      request.ticketId,
      await this.transcript(request.ticketId),
      context,
      // What the ticket IS, which is what a recommendation should be about —
      // the same input `Classify` uses. The transcript above still drives the
      // next steps: two outputs, two inputs.
      { title: ticket.title, body: ticket.description ?? '' },
    );

    return {
      items: suggestions.items,
      articles: suggestions.articles.map((article) => ({
        ...article,
        // `null` on this side of the boundary, `undefined` on the wire: proto3
        // has no null, so an absent `optional int32` is `undefined` and the
        // gateway's DTO turns it back into `null`. Converting here rather than
        // widening the domain type keeps "no pages" one concept with one
        // representation per layer.
        pageNumber: article.pageNumber ?? undefined,
      })),
    };
  }

  async classifyTicket(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<ClassifyTicketResponse> {
    const ticket = await this.access.load(request.ticketId, context);

    // **The EARLIEST message's files — the third selection rule.**
    //
    // `title` and `description` describe how the ticket opened, and this
    // surface reads nothing later: it never touches the conversation, so the
    // free win where the AI's own replies name an error code — the one
    // summaries inherit — does not reach it. A ticket whose body says "see
    // attached" routes on those two words unless the file comes too, and a
    // department chosen from them is not thin but WRONG, arriving with a
    // confidence score attached.
    //
    // Empty for a ticket opened by email, which has no message until somebody
    // replies. Accepted blindness rather than a wait — see the service.
    const attachments = await this.aiAttachments.forEarliestMessage(
      ticket.id,
      context,
    );

    // A SUGGESTION, never applied here. Auto-routing on a model's guess without
    // an agent confirming it would move tickets between teams on a confidence
    // score nobody looked at.
    const classification = await this.rag.classifyTicket(
      ticket.id,
      ticket.title,
      ticket.description ?? '',
      // The candidate departments travel WITH the request: rag-service cannot
      // see postgres_auth, and a suggestion naming a department that does not
      // exist is worse than no suggestion.
      await this.departmentOptions(context),
      context,
      attachments.parts,
    );

    return {
      ...classification,
      // Already narrowed at the rag boundary, so this is a widening back to the
      // wire rather than a check. A priority the model invented arrives here as
      // null and leaves as UNSPECIFIED, which the gateway renders as "no
      // suggestion" — the agent sees the department suggestion and no priority,
      // instead of a priority they never chose.
      suggestedPriority: toProtoTicketPriority(
        classification.suggestedPriority,
      ),
    };
  }

  /**
   * Generate and store, with the ESCALATION flag decided by the caller.
   *
   * Shared by the manual endpoint and the escalation hook so the two cannot
   * drift in what they persist — only in which gate they pass through.
   */
  private async summarize(
    ticketId: string,
    context: CallerContext,
    { triggeredByEscalation }: { triggeredByEscalation: boolean },
  ): Promise<AiSummaryResponse> {
    const ticket = await this.access.load(ticketId, context);

    const draft = await this.rag.generateSummary(
      ticket.id,
      await this.transcript(ticket.id),
      context,
      triggeredByEscalation,
    );

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
   * The ticket's conversation, oldest first.
   *
   * Sent with every generation request because rag-service owns no
   * conversation rows — `ticket_messages` lives here, and a second copy in a
   * second database is a consistency problem nobody asked for.
   *
   * Internal notes are INCLUDED: they are what an agent wrote about the ticket
   * and are exactly the context a summary or a draft should have. They never
   * reach the customer, because the draft is reviewed before anything is sent.
   */
  private async transcript(ticketId: string): Promise<ConversationTurn[]> {
    const messages = await this.prisma.ticketMessage.findMany({
      // **Refused messages never reach a prompt** — 36-doc §7.
      //
      // Filtered in the WHERE because this query is a dedicated transcript
      // read serving nothing else: there is no reason to fetch a row only to
      // drop it. The gateway's builder does the opposite for a reason its own
      // call site explains — the rows it drops are ones its caller is entitled
      // to see.
      //
      // Without this clause a question refused as injection is still in the
      // thread, and the next draft's transcript hands it straight back to the
      // model — which makes the refusal a delay rather than a defence.
      where: { ticketId, excludedFromAiContext: false },
      orderBy: { createdAt: 'asc' },
      select: { content: true, senderId: true, isAiGenerated: true },
      // Bounded. A 300-message thread is prompt tokens charged on every draft,
      // and the tail is what the reply is actually answering.
      take: TRANSCRIPT_TURNS,
    });

    return messages.map((message) => ({
      role: message.isAiGenerated || !message.senderId ? 'assistant' : 'user',
      content: message.content,
    }));
  }

  /**
   * Marks the refused message so it cannot reach a later prompt.
   *
   * **Only on an actual refusal.** rag-service refuses a draft with
   * `FAILED_PRECONDITION` and the `[http:422]` marker; a timeout, an outage or
   * a cap are different failures whose message is perfectly usable next time,
   * and excluding on those would quietly shrink a thread's context every time
   * the provider had a bad minute.
   *
   * **Never allowed to replace the original error.** The agent's answer is the
   * refusal; a bookkeeping write that failed must not turn that into something
   * else.
   */
  private async excludeRefused(
    ticketId: string,
    error: unknown,
  ): Promise<void> {
    if (!isDraftRefusal(error)) return;

    try {
      const messageId = await this.aiAttachments.lastUserMessageId(ticketId);
      if (!messageId) return;

      await this.prisma.ticketMessage.update({
        where: { id: messageId },
        data: { excludedFromAiContext: true },
      });
    } catch (writeError) {
      this.logger.error(
        `Could not exclude a refused message from AI context: ${formatErrorMsg(writeError)}`,
      );
    }
  }

  /** The tenant's departments, as classification candidates. */
  private async departmentOptions(
    context: CallerContext,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.authReference.listDepartments(context);
  }

  async listSimilarTickets(
    request: TicketAiRequest,
    context: CallerContext,
  ): Promise<ListSimilarTicketsResponse> {
    await this.access.load(request.ticketId, context);

    return { items: await this.rag.listSimilarTickets() };
  }
}

function toAiSummaryResponse(summary: AiSummary): AiSummaryResponse {
  return {
    id: summary.id,
    ticketId: summary.ticketId,
    summaryText: summary.summaryText,
    suggestedAction: summary.suggestedAction,
    confidenceScore: summary.confidenceScore,
    modelName: summary.modelName,
    createdAt: toProtoTimestamp(summary.createdAt),
    updatedAt: toProtoTimestamp(summary.updatedAt),
  };
}

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AttachmentPart,
  CallerContext,
  ConversationTurn,
  packRequestContext,
  RAG_GRPC_CLIENT,
  RAG_SERVICE_NAME,
  RagServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  TICKET_PRIORITIES,
  TicketPriority,
} from '@synapsedesk/common';

/**
 * Generation is slow — a draft with a review pass is three model calls — so the
 * shared 5-second deadline would turn every co-pilot request into a 504. The
 * agent is waiting and knows they are waiting; that is the trade
 * makes when it says the co-pilot is not streamed.
 */
const GENERATION_DEADLINE_MS = 60_000;

/** What a generated reply carries back. */
export type AiReplyDraft = {
  content: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  /** The ledger row id — handed back as `generatedFromId` when posting. */
  generationId: string;
  citations: Array<{
    chunkId: string;
    documentId: string;
    documentTitle: string;
    pageNumber: number | null;
  }>;
};

// ASK This `docblock` seems to be invalid
/**
 * A summary, WITHOUT token columns.
 *
 * `ai_summaries` has none in the RDM, and the reason is that summaries
 * append to `ai_generations` like every other spend. Adding token columns here
 * would grow a SECOND metering path beside the ledger — and the quota gate sums
 * the ledger, so the second path would be a number nobody gates on that looks
 * exactly like one they do.
 */
export type AiSummaryDraft = {
  summaryText: string;
  suggestedAction: string;
  confidenceScore: number;
  modelName: string;
  generationId: string;
};

/**
 * One article to recommend beside the next steps
 *
 * **Not `AiCitation` reused, and they must not be merged.** A citation points
 * at the PASSAGE an answer used and carries a `chunkId` so the answer can be
 * traced back to it; this points at the DOCUMENT an agent should open, where a
 * chunk id would be an implementation detail of how it was found.
 */
export type AiSuggestedArticle = {
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  score: number;
};

export type AiSuggestions = {
  items: AiSuggestion[];
  articles: AiSuggestedArticle[];
};

export type AiSuggestion = {
  title: string;
  body: string;
  confidenceScore: number;
};

export type AiClassification = {
  suggestedDepartmentId: string;
  /** Null when the model named something that is not a `TicketPriority`. */
  suggestedPriority: TicketPriority | null;
  confidenceScore: number;
};

export type SimilarTicket = {
  ticketId: string;
  ticketNumber: number;
  title: string;
  similarityScore: number;
};

/**
 * `ticket-service`'s connection to `rag-service` — §1.7's seam, now real.
 *
 * **Nothing here names a model, and that is the easiest possible version of doc
 * 15 §1.2.** This service never sees a model name as an INPUT: it sends a
 * conversation and gets back text plus the `model_name` that was actually used,
 * for display and for the `ticket_messages` row. Resolution happens inside
 * rag-service from `settings_for(organization_id)`, so there is no call site
 * here that COULD acquire a literal.
 *
 * Still optional. `RAG_SERVICE_URL` unset means every call answers UNAVAILABLE
 * (→ 503) rather than 500: "this feature is not up" is true and retryable,
 * while 500 would send someone debugging something that was never deployed.
 */
@Injectable()
export class RagClientService implements OnModuleInit {
  private readonly logger = new Logger(RagClientService.name);

  private readonly serviceUrl?: string;
  private ragService?: RagServiceClient;

  constructor(
    configService: ConfigService,
    @Inject(RAG_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {
    // Optional on purpose: making it required would mean ticket-service could
    // not boot until Domain C shipped, which would hold the whole support
    // engine hostage to a feature nobody had started.
    this.serviceUrl = configService.get<string>('RAG_SERVICE_URL');
  }

  onModuleInit(): void {
    if (!this.serviceUrl) return;

    this.ragService =
      this.client.getService<RagServiceClient>(RAG_SERVICE_NAME);
  }

  /** Whether a call would do anything — lets a caller skip it rather than catch. */
  get isAvailable(): boolean {
    return Boolean(this.serviceUrl);
  }

  async generateReplyDraft(
    ticketId: string,
    history: ConversationTurn[],
    context: CallerContext,
    maxRetries: number = 1,
    /**
     * The last user message's attachments
     *
     * Defaulted empty so a caller that has none says nothing, and so this
     * signature reads the same on both `Draft` paths. Filtered and fetched by
     * `AiAttachmentService`; by here they are already eligible and within
     * budget.
     */
    attachments: AttachmentPart[] = [],
  ): Promise<AiReplyDraft> {
    const rag = this.require('AI reply drafting');

    const response = await this.call(() =>
      firstValueFrom(
        rag
          .draft(
            { ticketId, history, maxRetries, attachments },
            packRequestContext(context),
          )
          .pipe(timeout(GENERATION_DEADLINE_MS)),
      ),
    );

    return {
      content: response.draft,
      // **THE RULE: populate model/token fields only where they cannot be read
      // as the meter.**
      //
      // Written down because this looks exactly like an inconsistency with
      // `generateSummary` below, which passes `modelName` straight through, and
      // an inconsistency is what a tidying pass removes in one line.
      //
      // The asymmetry is the design:
      //   - a DRAFT lands on `ticket_messages`, which HAS token columns, so
      //     filling them creates a second number that looks like spend beside
      //     `ai_generations` — the one the quota gate actually sums;
      //   - a SUMMARY lands on `ai_summaries`, where `model_name` is NOT NULL
      //     and there are no token columns at all, so it can only ever be
      //     display metadata.
      //
      // rag-service has already written the ledger row carrying the real model
      // and tokens. `rag-client.service.spec.ts` pins both sides.
      modelName: '',
      promptTokens: 0,
      completionTokens: 0,
      generationId: response.generationId,
      citations: response.citations.map((citation) => ({
        chunkId: citation.chunkId,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        pageNumber: citation.pageNumber ?? null,
      })),
    };
  }

  /**
   * `triggeredByEscalation` is passed straight through, and it decides the GATE
   * rather than the content.
   *
   * An escalation-triggered summary runs inside the 10% grace at the cap
   * (RDM §1.14); a manual one refuses. The asymmetry is deliberate and easy to
   * "simplify" away: at the cap deflection stops, so ticket volume spikes 3-5x,
   * and without the exemption every one of those tickets reaches an agent with
   * no context. The two failures compound.
   */
  async generateSummary(
    ticketId: string,
    history: ConversationTurn[],
    context: CallerContext,
    triggeredByEscalation: boolean = false,
  ): Promise<AiSummaryDraft> {
    const rag = this.require('AI summarization');

    const response = await this.call(() =>
      firstValueFrom(
        rag
          .summarize(
            { ticketId, history, triggeredByEscalation },
            packRequestContext(context),
          )
          .pipe(timeout(GENERATION_DEADLINE_MS)),
      ),
    );

    return {
      summaryText: response.summaryText,
      suggestedAction: response.suggestedAction,
      confidenceScore: response.confidenceScore,
      modelName: response.modelName,
      generationId: response.generationId,
    };
  }

  async getSuggestions(
    ticketId: string,
    history: ConversationTurn[],
    context: CallerContext,
    /**
     * What the ticket IS — the article sidebar's retrieval query
     *
     * Separate from `history`, which still drives the next-step list. The two
     * outputs come from two different inputs on purpose: next steps depend on
     * where the conversation got to, articles on what the ticket is about.
     */
    subject: { title: string; body: string },
  ): Promise<AiSuggestions> {
    const rag = this.require('AI suggestions');

    const response = await this.call(() =>
      firstValueFrom(
        rag
          .suggest(
            { ticketId, history, title: subject.title, body: subject.body },
            packRequestContext(context),
          )
          .pipe(timeout(GENERATION_DEADLINE_MS)),
      ),
    );

    return {
      items: response.suggestions.map((suggestion) => ({
        title: suggestion.title,
        body: suggestion.body,
        confidenceScore: suggestion.confidenceScore,
      })),
      articles: response.articles.map((article) => ({
        documentId: article.documentId,
        documentTitle: article.documentTitle,
        // `?? null` and the DTO is `| null` to match — a document with no pages
        // is a real answer, and proto3 hands an absent `optional int32` back as
        // `undefined`. The narrow-DTO reasoning, on a second surface.
        pageNumber: article.pageNumber ?? null,
        score: article.score,
      })),
    };
  }

  /**
   * The candidate departments are sent BY THIS SERVICE.
   *
   * rag-service cannot see `postgres_auth`, and a suggestion naming a
   * department that does not exist is worse than no suggestion: it either
   * fails a write or silently routes a ticket nowhere.
   */
  async classifyTicket(
    ticketId: string,
    title: string,
    body: string,
    departments: Array<{ id: string; name: string }>,
    context: CallerContext,
    /** The ticket's earliest message's files — the third selection rule. */
    attachments: AttachmentPart[] = [],
  ): Promise<AiClassification> {
    const rag = this.require('AI classification');

    const response = await this.call(() =>
      firstValueFrom(
        rag
          .classify(
            { ticketId, title, body, departments, attachments },
            packRequestContext(context),
          )
          .pipe(timeout(GENERATION_DEADLINE_MS)),
      ),
    );

    return {
      suggestedDepartmentId: response.suggestedDepartmentId,
      // The one hop where the value is a bare string from another language.
      suggestedPriority: TICKET_PRIORITIES.includes(
        response.suggestedPriority as TicketPriority,
      )
        ? (response.suggestedPriority as TicketPriority)
        : null,
      confidenceScore: response.confidenceScore,
    };
  }

  /**
   * Still unbuilt — a second corpus with its own pipeline.
   *
   * Kept as an explicit UNAVAILABLE rather than removed, so the endpoint that
   * calls it keeps answering "not up" instead of 404ing a route the plan says
   * exists.
   */
  listSimilarTickets(): Promise<SimilarTicket[]> {
    this.logger.debug('Similar-ticket search requested, but it is deferred');

    return Promise.reject(
      new RpcException({
        code: status.UNAVAILABLE,
        message: 'Similar-ticket search is not yet available',
      }),
    );
  }

  private require(capability: string): RagServiceClient {
    if (!this.ragService) {
      this.logger.debug(
        `${capability} requested, but RAG_SERVICE_URL is unset`,
      );

      throw new RpcException({
        code: status.UNAVAILABLE,
        message: `${capability} is not yet available`,
      });
    }

    return this.ragService;
  }

  /**
   * Passes a gRPC status through UNCHANGED and wraps everything else.
   *
   * The pass-through is what carries a 402 across two hops: rag-service refuses
   * at the cap with `PERMISSION_DENIED` plus the `[http:402]` marker, and
   * flattening that into a generic UNAVAILABLE here would tell an agent the
   * feature is down when the truth is that the workspace needs to buy more.
   */
  private async call<T>(invoke: () => Promise<T>): Promise<T> {
    try {
      return await invoke();
    } catch (error) {
      if (error instanceof RpcException) throw error;

      // A gRPC error crosses the wire as a PLAIN OBJECT carrying `code` — an
      // RpcException instance never survives the hop, so the shape has to be
      // read rather than instance-checked.
      const code = (error as { code?: number })?.code;
      if (typeof code === 'number') {
        throw new RpcException({
          code,
          message:
            (error as { details?: string }).details ?? 'The AI request failed',
        });
      }

      this.logger.error(`rag-service call failed: ${formatErrorMsg(error)}`);

      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'The AI service is not responding',
      });
    }
  }
}

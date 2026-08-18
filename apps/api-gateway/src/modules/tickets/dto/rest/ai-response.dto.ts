import { TicketPriority } from '@synapsedesk/common';

export class AiSummaryResponseDto {
  id!: string;
  ticketId!: string;
  summaryText!: string;
  suggestedAction!: string;
  confidenceScore!: number;
  modelName!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

/**
 * One source a draft used, as the REST surface publishes it.
 *
 * Carries no `vectorPointId` — that is an internal retrieval id, narrowed away
 * in `ai.service.ts` rather than served.
 */
export class DraftCitationResponseDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  /**
   * The page this citation points at, or `null` when the source document has no
   * pages — a pasted text file, an HTML article.
   */
  pageNumber!: number | null;
}

export class AiDraftResponseDto {
  content!: string;
  modelName!: string;
  promptTokens!: number;
  completionTokens!: number;
  /**
   * The `ai_generations` row this draft came from.
   *
   * **Hand it back as `generatedFromId` when posting the reply.** That is what
   * lets ticket-service record the draft as ACCEPTED or EDITED; omit it and the
   * hourly sweep records it as DISCARDED instead.
   *
   * @example
   * POST /tickets/:id/messages { content, generatedFromId: draft.generationId }
   */
  generationId!: string;
  citations!: DraftCitationResponseDto[];
}

/**
 * One knowledge-base article to recommend to an agent.
 *
 * Points at a DOCUMENT to open, where {@link DraftCitationResponseDto} points at the
 * PASSAGE an answer quoted — which is why this carries a `score` and no
 * `chunkId`.
 */
export class SuggestedArticleResponseDto {
  documentId!: string;
  documentTitle!: string;
  /** `null` for a source with no pages — a pasted text file, an HTML article. */
  pageNumber!: number | null;
  /** How well it matched, so a client can show or sort by relevance. */
  score!: number;
}

/**
 * What `POST /tickets/:id/ai/suggestions` answers with.
 *
 * @example
 * const { nextSteps, articles } = response.data;
 */
export class AiSuggestionsResponseDto {
  nextSteps!: AiSuggestionResponseDto[];
  articles!: SuggestedArticleResponseDto[];
}

export class AiSuggestionResponseDto {
  title!: string;
  body!: string;
  confidenceScore!: number;
}

/**
 * A SUGGESTION, never an applied change.
 *
 * Nothing in this response has been written to the ticket — an agent confirms
 * it. Auto-routing on a model's guess would move work between teams on a
 * confidence score nobody read.
 */
export class AiClassificationResponseDto {
  suggestedDepartmentId!: string;
  /**
   * Null when the model named something that is not a priority.
   *
   * The value crosses two hops: rag-service (Python) answers a bare string, and
   * ticket-service narrows it there — at the one boundary where it is genuinely
   * foreign — before putting it on `ClassifyTicketResponse` as a real enum. So a
   * `MEDIUM-HIGH` or a translated label arrives here as null rather than as a
   * suggestion the UI would render and no agent could apply.
   */
  suggestedPriority!: TicketPriority | null;
  confidenceScore!: number;
}

export class SimilarTicketResponseDto {
  ticketId!: string;
  ticketNumber!: number;
  title!: string;
  similarityScore!: number;
}

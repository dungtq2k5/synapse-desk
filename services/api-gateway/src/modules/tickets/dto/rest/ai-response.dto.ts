import { PickType } from '@nestjs/swagger';
import { RetrievalDegradation, TicketPriority } from '@synapsedesk/common';
import { CitationResponseDto } from './message-response.dto';

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
 * by the gateway's citation mapper rather than served (ADR 0031).
 */
export class DraftCitationResponseDto extends PickType(
  // **`PickType`, not `OmitType`.** Omit is allow-by-default: a field added to
  // `CitationResponseDto` would join this schema automatically, and this class
  // exists to publish a NARROWER shape than the wire carries. Pick names what is
  // served, so a new citation field reaches the draft only when someone adds it
  // here — the same allowlist `toDraftCitationResponseDto` already applies.
  CitationResponseDto,
  ['chunkId', 'documentId', 'documentTitle', 'pageNumber'] as const,
) {}

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
 * const { nextSteps, articles, degraded } = response.data;
 * if (degraded === 'LEXICAL_ONLY') showBudgetNotice(); // not "no suggestions"
 */
export class AiSuggestionsResponseDto {
  nextSteps!: AiSuggestionResponseDto[];
  articles!: SuggestedArticleResponseDto[];
  /**
   * `LEXICAL_ONLY` when the budget could not confirm room for a generation —
   * the workspace is at its AI allowance, or the quota counter was unreadable.
   * Then `nextSteps` is empty because the model was never called, and
   * `articles` came from keyword search. `null` on a normal answer, where an
   * empty `nextSteps` means the model had nothing to add.
   *
   * Read it before rendering an empty `nextSteps`: without it, a client shows
   * "no suggestions" where the truth is "allowance used".
   */
  degraded!: RetrievalDegradation | null;
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

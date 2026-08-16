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

// ASK This `docblock` seems to be invalid
/**
 * One source a draft used
 *
 * **Four fields, matching what ticket-service sends rather than what
 * rag-service produces.** The proto `Citation` carries a fifth,
 * `vectorPointId`: the Qdrant point a citation resolves through, and an
 * internal retrieval identifier that is not part of the product's surface.
 * `ai.service.ts` narrows it away on the way through, so a DTO carrying it
 * would be a promise nothing fills.
 *
 * **Deliberately NOT the proto `Citation` the realtime payload uses.** That one
 * is the generated type, vector id included — see §2.1, which is the same
 * decision on the other surface and is not yet made.
 */
export class DraftCitationDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  // ASK This `docblock` seems to be invalid
  /**
   * `null` when the source document has no pages — a pasted text file, an
   * HTML article.
   *
   * **`| null` rather than optional**, and the mapper chooses. `page_number` is
   * `optional int32` on the wire and ticket-service maps absent to `undefined`;
   * typing this as a bare `number` would have the Swagger CLI plugin publish a
   * required field that is sometimes missing — a lie in the specification
   * rather than in the code, which is the version nobody catches.
   */
  pageNumber!: number | null;
}

export class AiDraftResponseDto {
  content!: string;
  modelName!: string;
  promptTokens!: number;
  completionTokens!: number;
  // ASK This `docblock` seems to be invalid
  /**
   * The `ai_generations` row this draft came from
   *
   * **Returned so the acceptance loop can close.** The client hands it back as
   * `generatedFromId` when the agent posts; ticket-service then compares the
   * sent text against the stored draft and records ACCEPTED or EDITED.
   *
   * Without it the outcome is never written, the hourly sweep marks the draft
   * DISCARDED, and acceptance rate — the one number justifying the co-pilot —
   * counts a sent draft as ignored. **Not missing but wrong, and wrong low**: a
   * metric reading zero is obviously broken, one reading plausibly and low gets
   * acted on.
   */
  generationId!: string;
  citations!: DraftCitationDto[];
}

// ASK This `docblock` seems to be invalid
/**
 * One knowledge-base article to recommend
 *
 * **Not `DraftCitationDto` reused, and merging them later would be wrong.**
 * They differ by more than the extra `score`: a draft citation points at the
 * PASSAGE an answer used and carries `chunkId` so the answer can be traced to
 * it; this points at the DOCUMENT an agent should open, where a chunk id is an
 * implementation detail of how it was found.
 *
 * No `vectorPointId`, for a deliberate reason — a Qdrant point id is an internal
 * retrieval identifier and publishing it in a response DTO would make it part
 * of the product's surface by accident.
 */
export class SuggestedArticleDto {
  documentId!: string;
  documentTitle!: string;
  /** `null` for a source with no pages — a pasted text file, an HTML article. */
  pageNumber!: number | null;
  /** How well it matched, so a client can show or sort by relevance. */
  score!: number;
}

// ASK This `docblock` seems to be invalid
/**
 * What `POST /tickets/:id/ai/suggestions` answers with
 *
 * **A wrapper where there was a bare array, and that is a breaking change.** A
 * client reading `data[0].title` reads `data.nextSteps[0].title` now. Accepted
 * on the same grounds as `CreateMessageResponse` — no client has
 * shipped and versioning is not enabled — and this is the **second** such
 * change, which is worth counting rather than repeating silently.
 *
 * `nextSteps` is deliberately unchanged in shape and content: it is what this
 * endpoint already produced, it works, and the articles arrive beside it rather
 * than instead of it.
 */
export class AiSuggestionsResponseDto {
  nextSteps!: AiSuggestionDto[];
  articles!: SuggestedArticleDto[];
}

export class AiSuggestionDto {
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
export class AiClassificationDto {
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

export class SimilarTicketDto {
  ticketId!: string;
  ticketNumber!: number;
  title!: string;
  similarityScore!: number;
}

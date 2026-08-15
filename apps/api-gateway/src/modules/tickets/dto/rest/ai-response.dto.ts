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
 * One source a draft used — 38-doc §2.
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
  /**
   * The `ai_generations` row this draft came from — 38-doc §1.
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
  suggestedPriority!: string;
  confidenceScore!: number;
}

export class SimilarTicketDto {
  ticketId!: string;
  ticketNumber!: number;
  title!: string;
  similarityScore!: number;
}

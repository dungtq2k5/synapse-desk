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

export class AiDraftResponseDto {
  content!: string;
  modelName!: string;
  promptTokens!: number;
  completionTokens!: number;
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

import {
  AiSummaryResponse,
  ClassifyTicketResponse,
  fromProtoTicketPriority,
  GenerateDraftResponse,
  GetSuggestionsResponse,
  ListSimilarTicketsResponse,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  AiClassificationResponseDto,
  AiDraftResponseDto,
  AiSuggestionsResponseDto,
  AiSummaryResponseDto,
  SimilarTicketResponseDto,
} from './dto/rest/ai-response.dto';
import { toDraftCitationResponseDto } from './citation.mapper';

/**
 * Converts an `AiSummaryResponse` off the wire into its REST DTO.
 *
 * @throws Error if `createdAt` or `updatedAt` is missing, which the proto marks
 * non-optional.
 */
export function toAiSummaryResponseDto(
  summary: AiSummaryResponse,
): AiSummaryResponseDto {
  return {
    id: summary.id,
    ticketId: summary.ticketId,
    summaryText: summary.summaryText,
    suggestedAction: summary.suggestedAction,
    confidenceScore: summary.confidenceScore,
    modelName: summary.modelName,
    createdAt: requireProtoTimestamp(summary.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(summary.updatedAt, 'updatedAt'),
  };
}

/**
 * Converts a `GenerateDraftResponse` off the wire into its REST DTO.
 *
 * `generationId` is what closes the acceptance loop — the client hands it back
 * as `generatedFromId` when the agent posts the draft.
 */
export function toAiDraftResponseDto(
  response: GenerateDraftResponse,
): AiDraftResponseDto {
  return {
    content: response.content,
    modelName: response.modelName,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    generationId: response.generationId,
    citations: response.citations.map(toDraftCitationResponseDto),
  };
}

/** Converts a `GetSuggestionsResponse` off the wire into its REST DTO. */
export function toAiSuggestionsResponseDto(
  response: GetSuggestionsResponse,
): AiSuggestionsResponseDto {
  return {
    nextSteps: response.items.map((item) => ({
      title: item.title,
      body: item.body,
      confidenceScore: item.confidenceScore,
    })),
    articles: response.articles.map((article) => ({
      documentId: article.documentId,
      documentTitle: article.documentTitle,
      pageNumber: article.pageNumber ?? null,
      score: article.score,
    })),
  };
}

/**
 * Converts a `ClassifyTicketResponse` off the wire into its REST DTO.
 *
 * `suggestedPriority` is null when the model named something that is not a
 * `TicketPriority`.
 */
export function toAiClassificationResponseDto(
  response: ClassifyTicketResponse,
): AiClassificationResponseDto {
  return {
    suggestedDepartmentId: response.suggestedDepartmentId,
    suggestedPriority: fromProtoTicketPriority(response.suggestedPriority),
    confidenceScore: response.confidenceScore,
  };
}

/** Converts a `ListSimilarTicketsResponse` off the wire into its REST DTOs. */
export function toSimilarTicketResponseDtos(
  response: ListSimilarTicketsResponse,
): SimilarTicketResponseDto[] {
  return response.items.map((item) => ({
    ticketId: item.ticketId,
    ticketNumber: item.ticketNumber,
    title: item.title,
    similarityScore: item.similarityScore,
  }));
}

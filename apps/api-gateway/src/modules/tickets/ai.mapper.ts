import {
  AiSummaryResponse,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AiSummaryResponseDto } from './dto/rest/ai-response.dto';

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

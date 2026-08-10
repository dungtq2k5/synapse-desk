import {
  FeedbackResponse,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { FeedbackResponseDto } from './dto/rest/feedback-response.dto';
import { FeedbackRating } from '@synapsedesk/common';

export function toFeedbackResponseDto(
  feedback: FeedbackResponse,
): FeedbackResponseDto {
  return {
    id: feedback.id,
    ticketMessageId: feedback.ticketMessageId,
    userId: feedback.userId,
    organizationId: feedback.organizationId,
    rating: feedback.rating as FeedbackRating,
    feedbackText: feedback.feedbackText ?? null,
    // `?? null`, never `|| null`: `false` is a real assessment — "the citations
    // were wrong" — and `||` would erase it into "not assessed".
    citationAccurate: feedback.citationAccurate ?? null,
    createdAt: requireProtoTimestamp(feedback.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(feedback.updatedAt, 'updatedAt'),
  };
}

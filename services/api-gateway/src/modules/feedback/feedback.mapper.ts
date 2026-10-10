import {
  FeedbackResponse,
  ListFeedbackRequest,
  ListFeedbackResponse,
  requireProtoTimestamp,
  toPageRequest,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { ListFeedbackQueryDto } from './dto/rest/feedback.dto';
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

/**
 * Builds a `ListFeedbackRequest` from the REST query.
 *
 * A zero `rating` is the proto zero value, which the service reads as "no
 * filter"; legal ratings are 1 and -1, so it cannot be mistaken for one.
 */
export function toListFeedbackRequest(
  query: ListFeedbackQueryDto,
): ListFeedbackRequest {
  return {
    page: toPageRequest(query),
    // The `??` stays, and the DTO field stays optional: `0` is the proto's
    // "no filter" zero and is NOT a member of `FEEDBACK_RATINGS`, so defaulting
    // the DTO to it would fail that field's own `@IsIn` on every unfiltered
    // request. The translation belongs here, at the wire.
    rating: query.rating ?? 0,
    citationAccurate: query.citationAccurate,
    from: toProtoTimestamp(query.from ?? null),
    to: toProtoTimestamp(query.to ?? null),
  };
}

/** Converts a `ListFeedbackResponse` into the paginated REST envelope. */
export function toFeedbackPageDto(
  response: ListFeedbackResponse,
): PaginationResponseDto<FeedbackResponseDto> {
  return {
    items: response.items.map(toFeedbackResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { FeedbackGrpcClient } from './feedback-grpc.client';
import {
  toFeedbackPageDto,
  toFeedbackResponseDto,
  toListFeedbackRequest,
} from './feedback.mapper';
import { FeedbackResponseDto } from './dto/rest/feedback-response.dto';
import {
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
} from './dto/rest/feedback.dto';

/** The gateway's feedback surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class FeedbackService {
  constructor(private readonly feedbackGrpcClient: FeedbackGrpcClient) {}

  async submit(
    ticketMessageId: string,
    dto: SubmitFeedbackDto,
    context: RequestContext,
  ): Promise<FeedbackResponseDto> {
    return toFeedbackResponseDto(
      await this.feedbackGrpcClient.submit(
        {
          ticketMessageId,
          rating: dto.rating,
          feedbackText: dto.feedbackText,
          citationAccurate: dto.citationAccurate,
        },
        context,
      ),
    );
  }

  /**
   * The caller's own rating, or `null` when they have not rated the message.
   *
   * `null` rather than a 404: a client renders a thumb control on every AI
   * message and asks this for each one, so "not rated" is the ordinary answer.
   */
  async get(
    ticketMessageId: string,
    context: RequestContext,
  ): Promise<FeedbackResponseDto | null> {
    const { feedback } = await this.feedbackGrpcClient.get(
      ticketMessageId,
      context,
    );

    return feedback ? toFeedbackResponseDto(feedback) : null;
  }

  withdraw(ticketMessageId: string, context: RequestContext): Promise<void> {
    return this.feedbackGrpcClient.withdraw(ticketMessageId, context);
  }

  async list(
    query: ListFeedbackQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<FeedbackResponseDto>> {
    return toFeedbackPageDto(
      await this.feedbackGrpcClient.list(toListFeedbackRequest(query), context),
    );
  }
}

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

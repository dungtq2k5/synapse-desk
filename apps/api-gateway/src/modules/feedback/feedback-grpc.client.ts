import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  FEEDBACK_SERVICE_NAME,
  FeedbackResponse,
  FeedbackServiceClient,
  requireTimestamp,
  TICKET_GRPC_CLIENT,
  toPageRequest,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import { FeedbackRating, RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import { FeedbackResponseDto } from './dto/rest/feedback-response.dto';
import {
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
} from './dto/rest/feedback.dto';

function toFeedbackDto(feedback: FeedbackResponse): FeedbackResponseDto {
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
    createdAt: requireTimestamp(feedback.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(feedback.updatedAt, 'updatedAt'),
  };
}

@Injectable()
export class FeedbackGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'ticket-service';

  private feedbackGrpcService!: FeedbackServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.feedbackGrpcService = this.client.getService<FeedbackServiceClient>(
      FEEDBACK_SERVICE_NAME,
    );
  }

  async submit(
    ticketMessageId: string,
    dto: SubmitFeedbackDto,
    context: RequestContext,
  ): Promise<FeedbackResponseDto> {
    return toFeedbackDto(
      await this.call(
        (metadata) =>
          this.feedbackGrpcService.submitFeedback(
            {
              ticketMessageId,
              rating: dto.rating,
              feedbackText: dto.feedbackText,
              citationAccurate: dto.citationAccurate,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async withdraw(
    ticketMessageId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.feedbackGrpcService.withdrawFeedback(
          { ticketMessageId },
          metadata,
        ),
      context,
    );
  }

  async list(
    query: ListFeedbackQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<FeedbackResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.feedbackGrpcService.listFeedback(
          {
            page: toPageRequest(query),
            // 0 is the proto zero value, which the service reads as "no
            // filter". Legal ratings are 1 and -1, so it cannot be mistaken for
            // a real one.
            rating: query.rating ?? 0,
            citationAccurate: query.citationAccurate,
            from: toTimestamp(query.from ?? null),
            to: toTimestamp(query.to ?? null),
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toFeedbackDto),
      meta: toPaginationMeta(response.meta),
    };
  }
}

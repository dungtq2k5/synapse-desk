import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  FEEDBACK_SERVICE_NAME,
  FeedbackServiceClient,
  TICKET_GRPC_CLIENT,
  toPageRequest,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { FeedbackResponseDto } from './dto/rest/feedback-response.dto';
import {
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
} from './dto/rest/feedback.dto';
import { toFeedbackResponseDto } from './feedback.mapper';

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
    return toFeedbackResponseDto(
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
  ): Promise<PaginationResponseDto<FeedbackResponseDto>> {
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
            from: toProtoTimestamp(query.from ?? null),
            to: toProtoTimestamp(query.to ?? null),
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toFeedbackResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }
}

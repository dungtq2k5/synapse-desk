import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  FEEDBACK_SERVICE_NAME,
  FeedbackServiceClient,
  TICKET_GRPC_CLIENT,
  FeedbackResponse,
  ListFeedbackRequest,
  ListFeedbackResponse,
  GetFeedbackResponse,
  SubmitFeedbackRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  submit(
    request: SubmitFeedbackRequest,
    context: RequestContext,
  ): Promise<FeedbackResponse> {
    return this.call(
      (metadata) => this.feedbackGrpcService.submitFeedback(request, metadata),
      context,
    );
  }

  get(
    ticketMessageId: string,
    context: RequestContext,
  ): Promise<GetFeedbackResponse> {
    return this.call(
      (metadata) =>
        this.feedbackGrpcService.getFeedback({ ticketMessageId }, metadata),
      context,
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

  list(
    request: ListFeedbackRequest,
    context: RequestContext,
  ): Promise<ListFeedbackResponse> {
    return this.call(
      (metadata) => this.feedbackGrpcService.listFeedback(request, metadata),
      context,
    );
  }
}

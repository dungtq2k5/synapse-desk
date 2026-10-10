import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AI_SERVICE_NAME,
  AiServiceClient,
  TICKET_GRPC_CLIENT,
  AiSummaryResponse,
  ClassifyTicketResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  GetSuggestionsResponse,
  ListSimilarTicketsResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class AiGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'ticket-service';

  private aiGrpcService!: AiServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.aiGrpcService =
      this.client.getService<AiServiceClient>(AI_SERVICE_NAME);
  }

  getSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponse> {
    return this.call(
      (metadata) => this.aiGrpcService.getSummary({ ticketId }, metadata),
      context,
    );
  }

  generateSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponse> {
    return this.call(
      (metadata) => this.aiGrpcService.generateSummary({ ticketId }, metadata),
      context,
    );
  }

  generateDraft(
    request: GenerateDraftRequest,
    context: RequestContext,
  ): Promise<GenerateDraftResponse> {
    return this.call(
      (metadata) => this.aiGrpcService.generateDraft(request, metadata),
      context,
    );
  }

  getSuggestions(
    ticketId: string,
    context: RequestContext,
  ): Promise<GetSuggestionsResponse> {
    return this.call(
      (metadata) => this.aiGrpcService.getSuggestions({ ticketId }, metadata),
      context,
    );
  }

  classifyTicket(
    ticketId: string,
    context: RequestContext,
  ): Promise<ClassifyTicketResponse> {
    return this.call(
      (metadata) => this.aiGrpcService.classifyTicket({ ticketId }, metadata),
      context,
    );
  }

  listSimilarTickets(
    ticketId: string,
    context: RequestContext,
  ): Promise<ListSimilarTicketsResponse> {
    return this.call(
      (metadata) =>
        this.aiGrpcService.listSimilarTickets({ ticketId }, metadata),
      context,
    );
  }
}

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AI_SERVICE_NAME,
  AiServiceClient,
  requireTimestamp,
  TICKET_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { GenerateDraftDto } from './dto/rest/ai.dto';
import {
  AiClassificationDto,
  AiDraftResponseDto,
  AiSuggestionDto,
  AiSummaryResponseDto,
  SimilarTicketDto,
} from './dto/rest/ai-response.dto';

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

  async getSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponseDto> {
    return this.toSummaryDto(
      await this.call(
        (metadata) => this.aiGrpcService.getSummary({ ticketId }, metadata),
        context,
      ),
    );
  }

  async generateSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponseDto> {
    return this.toSummaryDto(
      await this.call(
        (metadata) =>
          this.aiGrpcService.generateSummary({ ticketId }, metadata),
        context,
      ),
    );
  }

  async generateDraft(
    ticketId: string,
    dto: GenerateDraftDto,
    context: RequestContext,
  ): Promise<AiDraftResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.aiGrpcService.generateDraft(
          { ticketId, instruction: dto.instruction },
          metadata,
        ),
      context,
    );

    return {
      content: response.content,
      modelName: response.modelName,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  }

  async getSuggestions(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSuggestionDto[]> {
    const response = await this.call(
      (metadata) => this.aiGrpcService.getSuggestions({ ticketId }, metadata),
      context,
    );

    return response.items.map((item) => ({
      title: item.title,
      body: item.body,
      confidenceScore: item.confidenceScore,
    }));
  }

  async classifyTicket(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiClassificationDto> {
    const response = await this.call(
      (metadata) => this.aiGrpcService.classifyTicket({ ticketId }, metadata),
      context,
    );

    return {
      suggestedDepartmentId: response.suggestedDepartmentId,
      suggestedPriority: response.suggestedPriority,
      confidenceScore: response.confidenceScore,
    };
  }

  async listSimilarTickets(
    ticketId: string,
    context: RequestContext,
  ): Promise<SimilarTicketDto[]> {
    const response = await this.call(
      (metadata) =>
        this.aiGrpcService.listSimilarTickets({ ticketId }, metadata),
      context,
    );

    return response.items.map((item) => ({
      ticketId: item.ticketId,
      ticketNumber: item.ticketNumber,
      title: item.title,
      similarityScore: item.similarityScore,
    }));
  }

  private toSummaryDto(summary: {
    id: string;
    ticketId: string;
    summaryText: string;
    suggestedAction: string;
    confidenceScore: number;
    modelName: string;
    createdAt?: { seconds: number; nanos: number };
    updatedAt?: { seconds: number; nanos: number };
  }): AiSummaryResponseDto {
    return {
      id: summary.id,
      ticketId: summary.ticketId,
      summaryText: summary.summaryText,
      suggestedAction: summary.suggestedAction,
      confidenceScore: summary.confidenceScore,
      modelName: summary.modelName,
      createdAt: requireTimestamp(summary.createdAt, 'createdAt'),
      updatedAt: requireTimestamp(summary.updatedAt, 'updatedAt'),
    };
  }
}

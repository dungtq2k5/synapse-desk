import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AI_SERVICE_NAME,
  AiServiceClient,
  TICKET_GRPC_CLIENT,
  fromProtoTicketPriority,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { toAiSummaryResponseDto } from './ai.mapper';
import { GenerateDraftDto } from './dto/rest/ai.dto';
import {
  AiClassificationDto,
  AiDraftResponseDto,
  AiSuggestionsResponseDto,
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
    return toAiSummaryResponseDto(
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
    return toAiSummaryResponseDto(
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
      // **Both of these were read off the response and not copied** — 38-doc
      // §1. Every service satisfied its own contract and this boundary is the
      // one no test crossed, which is why BOTH halves of the loop were missing
      // here rather than one.
      generationId: response.generationId,
      citations: response.citations.map((citation) => ({
        chunkId: citation.chunkId,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        // `?? null`, and the DTO is `| null` to match: proto3 hands an absent
        // `optional int32` back as `undefined`, and publishing that as a
        // required number would misdescribe the response rather than break it.
        pageNumber: citation.pageNumber ?? null,
      })),
    };
  }

  async getSuggestions(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSuggestionsResponseDto> {
    const response = await this.call(
      (metadata) => this.aiGrpcService.getSuggestions({ ticketId }, metadata),
      context,
    );

    return {
      nextSteps: response.items.map((item) => ({
        title: item.title,
        body: item.body,
        confidenceScore: item.confidenceScore,
      })),
      articles: response.articles.map((article) => ({
        documentId: article.documentId,
        documentTitle: article.documentTitle,
        pageNumber: article.pageNumber ?? null,
        score: article.score,
      })),
    };
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
      suggestedPriority: fromProtoTicketPriority(response.suggestedPriority),
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
}

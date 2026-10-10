import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { AiGrpcClient } from './ai-grpc.client';
import {
  toAiClassificationResponseDto,
  toAiDraftResponseDto,
  toAiSuggestionsResponseDto,
  toAiSummaryResponseDto,
  toSimilarTicketResponseDtos,
} from './ai.mapper';
import { GenerateDraftDto } from './dto/rest/ai.dto';
import {
  AiClassificationResponseDto,
  AiDraftResponseDto,
  AiSuggestionsResponseDto,
  AiSummaryResponseDto,
  SimilarTicketResponseDto,
} from './dto/rest/ai-response.dto';

/** The gateway's AI co-pilot surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class AiService {
  constructor(private readonly aiGrpcClient: AiGrpcClient) {}

  async getSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponseDto> {
    return toAiSummaryResponseDto(
      await this.aiGrpcClient.getSummary(ticketId, context),
    );
  }

  async generateSummary(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSummaryResponseDto> {
    return toAiSummaryResponseDto(
      await this.aiGrpcClient.generateSummary(ticketId, context),
    );
  }

  async generateDraft(
    ticketId: string,
    dto: GenerateDraftDto,
    context: RequestContext,
  ): Promise<AiDraftResponseDto> {
    return toAiDraftResponseDto(
      await this.aiGrpcClient.generateDraft(
        { ticketId, instruction: dto.instruction },
        context,
      ),
    );
  }

  async getSuggestions(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiSuggestionsResponseDto> {
    return toAiSuggestionsResponseDto(
      await this.aiGrpcClient.getSuggestions(ticketId, context),
    );
  }

  async classifyTicket(
    ticketId: string,
    context: RequestContext,
  ): Promise<AiClassificationResponseDto> {
    return toAiClassificationResponseDto(
      await this.aiGrpcClient.classifyTicket(ticketId, context),
    );
  }

  async listSimilarTickets(
    ticketId: string,
    context: RequestContext,
  ): Promise<SimilarTicketResponseDto[]> {
    return toSimilarTicketResponseDtos(
      await this.aiGrpcClient.listSimilarTickets(ticketId, context),
    );
  }
}

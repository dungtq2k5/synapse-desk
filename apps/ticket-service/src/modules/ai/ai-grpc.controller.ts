import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AiServiceController,
  AiServiceControllerMethods,
  AiSummaryResponse,
  ClassifyTicketResponse,
  GenerateDraftRequest,
  GenerateDraftResponse,
  GetSuggestionsResponse,
  ListSimilarTicketsResponse,
  TicketAiRequest,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { AiService } from './ai.service';

@Controller()
@AiServiceControllerMethods()
export class AiGrpcController implements AiServiceController {
  constructor(private readonly ai: AiService) {}

  generateSummary(
    request: TicketAiRequest,
    metadata?: Metadata,
  ): Promise<AiSummaryResponse> {
    return this.ai.generateSummary(request, unpackCallerContext(metadata));
  }

  getSummary(
    request: TicketAiRequest,
    metadata?: Metadata,
  ): Promise<AiSummaryResponse> {
    return this.ai.getSummary(request, unpackCallerContext(metadata));
  }

  generateDraft(
    request: GenerateDraftRequest,
    metadata?: Metadata,
  ): Promise<GenerateDraftResponse> {
    return this.ai.generateDraft(request, unpackCallerContext(metadata));
  }

  getSuggestions(
    request: TicketAiRequest,
    metadata?: Metadata,
  ): Promise<GetSuggestionsResponse> {
    return this.ai.getSuggestions(request, unpackCallerContext(metadata));
  }

  classifyTicket(
    request: TicketAiRequest,
    metadata?: Metadata,
  ): Promise<ClassifyTicketResponse> {
    return this.ai.classifyTicket(request, unpackCallerContext(metadata));
  }

  listSimilarTickets(
    request: TicketAiRequest,
    metadata?: Metadata,
  ): Promise<ListSimilarTicketsResponse> {
    return this.ai.listSimilarTickets(request, unpackCallerContext(metadata));
  }
}

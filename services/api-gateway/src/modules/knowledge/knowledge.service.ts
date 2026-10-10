import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { KnowledgeGrpcClient } from './knowledge-grpc.client';
import {
  toChatRequest,
  toKnowledgeAskResponseDto,
  toKnowledgeSearchResponseDto,
  toSearchRequest,
} from './knowledge.mapper';
import { KnowledgeAskDto, KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import {
  KnowledgeAskResponseDto,
  KnowledgeSearchResponseDto,
} from './dto/rest/knowledge-response.dto';

/** The gateway's knowledge surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class KnowledgeService {
  constructor(private readonly knowledgeGrpcClient: KnowledgeGrpcClient) {}

  /**
   * One-shot Q&A.
   *
   * **Refuses at the AI cap where `search` degrades**, and both are right:
   * search can drop the embedding call and still answer from its lexical arm,
   * while an ANSWER has no degraded form. `rag-service` aborts with an
   * `[http:402]` marker, so the cap surfaces as 402 Payment Required rather
   * than the 403 the gRPC code table would otherwise produce.
   */
  async ask(
    dto: KnowledgeAskDto,
    context: RequestContext,
  ): Promise<KnowledgeAskResponseDto> {
    return toKnowledgeAskResponseDto(
      await this.knowledgeGrpcClient.ask(toChatRequest(dto), context),
    );
  }

  async search(
    dto: KnowledgeSearchDto,
    context: RequestContext,
  ): Promise<KnowledgeSearchResponseDto> {
    return toKnowledgeSearchResponseDto(
      await this.knowledgeGrpcClient.search(toSearchRequest(dto), context),
    );
  }
}

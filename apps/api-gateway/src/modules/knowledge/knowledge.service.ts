import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { KnowledgeGrpcClient } from './knowledge-grpc.client';
import {
  toKnowledgeSearchResponseDto,
  toSearchRequest,
} from './knowledge.mapper';
import { KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import { KnowledgeSearchResponseDto } from './dto/rest/knowledge-response.dto';

/** The gateway's knowledge surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class KnowledgeService {
  constructor(private readonly knowledgeGrpcClient: KnowledgeGrpcClient) {}

  async search(
    dto: KnowledgeSearchDto,
    context: RequestContext,
  ): Promise<KnowledgeSearchResponseDto> {
    return toKnowledgeSearchResponseDto(
      await this.knowledgeGrpcClient.search(toSearchRequest(dto), context),
    );
  }
}

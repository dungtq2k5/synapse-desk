import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { KnowledgeArticlesGrpcClient } from './knowledge-articles-grpc.client';
import {
  toGetKnowledgeArticleRequest,
  toKnowledgeArticleDetailResponseDto,
  toKnowledgeArticlePageDto,
  toListKnowledgeArticlesRequest,
} from './knowledge-article.mapper';
import {
  KnowledgeArticleBlocksQueryDto,
  ListKnowledgeArticlesQueryDto,
} from './dto/rest/knowledge.dto';
import {
  KnowledgeArticleDetailResponseDto,
  KnowledgeArticleResponseDto,
} from './dto/rest/knowledge-article-response.dto';

/**
 * The help centre, mapped for REST.
 *
 * Separate from `KnowledgeService`, which owns `search` and `ask`: those reach
 * `rag-service` and these reach `ingestion-service`. The two share a URL prefix
 * and an audience, and nothing else.
 */
@Injectable()
export class KnowledgeArticlesService {
  constructor(private readonly client: KnowledgeArticlesGrpcClient) {}

  async list(
    query: ListKnowledgeArticlesQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<KnowledgeArticleResponseDto>> {
    return toKnowledgeArticlePageDto(
      await this.client.list(toListKnowledgeArticlesRequest(query), context),
    );
  }

  async get(
    id: string,
    query: KnowledgeArticleBlocksQueryDto,
    context: RequestContext,
  ): Promise<KnowledgeArticleDetailResponseDto> {
    return toKnowledgeArticleDetailResponseDto(
      await this.client.get(toGetKnowledgeArticleRequest(id, query), context),
    );
  }
}

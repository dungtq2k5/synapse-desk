import {
  GetKnowledgeArticleRequest,
  KnowledgeArticleDetailResponse,
  KnowledgeArticleResponse,
  ListKnowledgeArticlesRequest,
  ListKnowledgeArticlesResponse,
  requireProtoTimestamp,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { DEFAULT_SEARCH } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import {
  ListKnowledgeArticlesQueryDto,
  KnowledgeArticleBlocksQueryDto,
} from './dto/rest/knowledge.dto';
import {
  KnowledgeArticleDetailResponseDto,
  KnowledgeArticleResponseDto,
} from './dto/rest/knowledge-article-response.dto';

export function toListKnowledgeArticlesRequest(
  query: ListKnowledgeArticlesQueryDto,
): ListKnowledgeArticlesRequest {
  return { page: toPageRequest(query) };
}

export function toGetKnowledgeArticleRequest(
  id: string,
  query: KnowledgeArticleBlocksQueryDto,
): GetKnowledgeArticleRequest {
  return {
    id,
    // The page is the BLOCK range, not a page of articles.
    //
    // **`sortBy` is deliberately EMPTY, not `'chunkIndex'`.** `toPrismaPage`
    // reads `page.sortBy || sortable[0]`, so the service supplies the column
    // from its own allowlist — and naming it here would restate
    // `DOCUMENT_CHUNK_SORTABLE_FIELDS`, which `pagination.config.ts` requires
    // be declared once for both edges. Two literals that must agree, where
    // disagreement is `toPrismaPage` THROWING and every detail request
    // becoming a 400 no test can reach, because the DTO cannot send `sortBy`.
    //
    // Nothing is lost: the derived `orderBy` is discarded anyway for the fixed
    // `chunkIndex: 'asc'` that keeps the document in reading order.
    page: toPageRequest({
      page: query.page,
      limit: query.limit,
      sortBy: '',
      sortOrder: DEFAULT_SEARCH.SORT_ORDER,
    }),
  };
}

/**
 * @throws Error if `updatedAt` is missing, which the proto requires.
 */
export function toKnowledgeArticleResponseDto(
  article: KnowledgeArticleResponse,
): KnowledgeArticleResponseDto {
  return {
    id: article.id,
    title: article.title,
    updatedAt: requireProtoTimestamp(article.updatedAt, 'updatedAt'),
    chunkCount: article.chunkCount,
  };
}

export function toKnowledgeArticlePageDto(
  response: ListKnowledgeArticlesResponse,
): PaginationResponseDto<KnowledgeArticleResponseDto> {
  return {
    items: response.items.map(toKnowledgeArticleResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * @throws Error if the peer sent no `article`, which the proto requires.
 */
export function toKnowledgeArticleDetailResponseDto(
  response: KnowledgeArticleDetailResponse,
): KnowledgeArticleDetailResponseDto {
  if (!response.article) {
    throw new Error('The peer returned an article detail with no article');
  }

  return {
    article: toKnowledgeArticleResponseDto(response.article),
    blocks: response.blocks.map((block) => ({
      chunkIndex: block.chunkIndex,
      // '' would be a block with no text; absent is a format with no pages.
      pageNumber: block.pageNumber ?? null,
      contentText: block.contentText,
    })),
    meta: toPaginationMetaDataResponseDto(response.meta),
    hasUnindexedPages: response.hasUnindexedPages,
  };
}

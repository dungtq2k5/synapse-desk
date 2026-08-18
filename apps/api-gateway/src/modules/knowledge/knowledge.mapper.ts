import {
  SearchDegradation,
  SearchRequest,
  SearchResponse,
} from '@synapsedesk/grpc-proto';
import { KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import { KnowledgeSearchResponseDto } from './dto/rest/knowledge-response.dto';

/**
 * Builds a `SearchRequest` from the REST query.
 *
 * A zero `limit` means "use the configured default", resolved server-side from
 * the settings layer rather than duplicated here.
 */
export function toSearchRequest(dto: KnowledgeSearchDto): SearchRequest {
  return {
    query: dto.query,
    limit: dto.limit,
    skipRerank: dto.skipRerank,
  };
}

/**
 * Converts a `SearchResponse` off the wire into its REST DTO.
 *
 * `degraded` becomes a name rather than the proto enum's number, which is
 * meaningless to the client that has to decide whether to warn the user.
 */
export function toKnowledgeSearchResponseDto(
  response: SearchResponse,
): KnowledgeSearchResponseDto {
  return {
    chunks: response.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      pageNumber: chunk.pageNumber ?? null,
      chunkIndex: chunk.chunkIndex,
      contentText: chunk.contentText,
      score: chunk.score,
      vectorPointId: chunk.vectorPointId,
    })),
    degraded:
      response.degraded === SearchDegradation.SEARCH_DEGRADATION_LEXICAL_ONLY
        ? 'LEXICAL_ONLY'
        : null,
  };
}

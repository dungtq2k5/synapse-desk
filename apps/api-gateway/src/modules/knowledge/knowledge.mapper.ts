import {
  ChatRequest,
  ChatResponse,
  fromProtoRagAnswerStatus,
  SearchDegradation,
  SearchRequest,
  SearchResponse,
} from '@synapsedesk/grpc-proto';
import { KnowledgeAskDto, KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import {
  KnowledgeAskResponseDto,
  KnowledgeSearchResponseDto,
} from './dto/rest/knowledge-response.dto';
import { toCitationResponseDto } from '../tickets/citation.mapper';

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

/**
 * Builds the `ChatRequest` an ask sends.
 *
 * `history` and `ticketId` are BOTH omitted, and both matter: no history is
 * what keeps this one-shot, and no ticket id is what makes the ledger row come
 * out as `CHAT_ANSWER` with `ticket_id = NULL` — the attribution that
 * distinguishes help-centre spend from ticket spend.
 */
export function toChatRequest(dto: KnowledgeAskDto): ChatRequest {
  // `attachments` is empty and cannot be otherwise: an ask has no ticket and no
  // message, so there is nothing to attach. `rag-service`'s `Ask` says the same
  // — the field is on `ChatRequest` for the chat path.
  //
  // `attachmentCount: 0` for the same reason, and it is not a placeholder: the
  // greeting short-circuit is CORRECT here. "hi" typed into the help centre
  // carries no file and should cost nothing.
  return {
    message: dto.message,
    history: [],
    attachments: [],
    attachmentCount: 0,
  };
}

/** Converts a `ChatResponse` off the wire into its REST DTO. */
export function toKnowledgeAskResponseDto(
  response: ChatResponse,
): KnowledgeAskResponseDto {
  return {
    content: response.content,
    status: fromProtoRagAnswerStatus(response.status),
    citations: response.citations.map(toCitationResponseDto),
    generationId: response.generationId,
  };
}

import { AnswerStatus } from '@synapsedesk/common';
import { CitationResponseDto } from '../../../tickets/dto/rest/message-response.dto';

export class RetrievedChunkResponseDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  /** NULL for formats with no pages — never faked as 1. */
  pageNumber!: number | null;
  chunkIndex!: number;
  contentText!: string;
  score!: number;
  /** The id a citation resolves through, and the two arms' fusion key. */
  vectorPointId!: string;
}

export class KnowledgeSearchResponseDto {
  chunks!: RetrievedChunkResponseDto[];

  /**
   * Why this result set is thinner than usual, or `null` when it is not.
   *
   * `LEXICAL_ONLY` means the vector search was skipped.
   */
  // In the RESPONSE rather than only in a log: a caller that cannot tell
  // degraded results from normal ones presents them as normal ones, and "the
  // search got worse" then gets reported as a quality problem, not a billing one.
  degraded!: 'LEXICAL_ONLY' | null;
}

/**
 * One answer to a one-shot question.
 *
 * `status` is the same `AnswerStatus` a ticket answer carries, and
 * `DOC_MISSING` is the one that matters here: it means nothing in the corpus
 * covers the question, and the content says so explicitly rather than
 * improvising. There is no conversation to escalate into on this surface, which
 * is why the status is on the response rather than acted on for the caller.
 */
export class KnowledgeAskResponseDto {
  content!: string;
  /** `null` only if the peer sent a member this build does not know. */
  status!: AnswerStatus | null;
  citations!: CitationResponseDto[];
  /**
   * The `ai_generations` row this answer was billed to.
   *
   * Returned so the answer is identifiable after the fact. Nothing can rate it
   * yet — `ai_response_feedbacks` is keyed on `ticket_message_id` and an ask
   * produces no message.
   */
  generationId!: string;
}

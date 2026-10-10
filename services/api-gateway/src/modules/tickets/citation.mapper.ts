import { CitationResponseDto } from './dto/rest/message-response.dto';
import { DraftCitationResponseDto } from './dto/rest/ai-response.dto';

/**
 * A citation off the wire — rag's `Citation` or ticket's `DraftCitation`.
 *
 * Structural rather than either generated type: the two are field-for-field
 * identical, and this file is the one place both arrive.
 */
type WireCitation = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  vectorPointId: string;
};

/**
 * Converts a wire citation into the REST shape every citation surface serves.
 *
 * @example
 * toCitationResponseDto({ chunkId, documentId, documentTitle, vectorPointId })
 * // { chunkId, documentId, documentTitle, pageNumber: null, vectorPointId }
 */
export function toCitationResponseDto(
  citation: WireCitation,
): CitationResponseDto {
  return {
    chunkId: citation.chunkId,
    documentId: citation.documentId,
    documentTitle: citation.documentTitle,
    // `?? null`: an absent `optional int32` is a document with no pages, and
    // serving the key as missing would publish a field that is sometimes gone.
    pageNumber: citation.pageNumber ?? null,
    vectorPointId: citation.vectorPointId,
  };
}

/**
 * Converts a wire citation into a draft's citation — the same shape without
 * `vectorPointId`.
 *
 * @example
 * toDraftCitationResponseDto(citation)
 * // { chunkId, documentId, documentTitle, pageNumber }
 */
export function toDraftCitationResponseDto(
  citation: WireCitation,
): DraftCitationResponseDto {
  // Picked from the one mapping above, so the page-number rule cannot drift.
  // `vectorPointId` is left out on purpose — `ai.e2e-spec.ts` test 5.
  const { chunkId, documentId, documentTitle, pageNumber } =
    toCitationResponseDto(citation);

  return { chunkId, documentId, documentTitle, pageNumber };
}

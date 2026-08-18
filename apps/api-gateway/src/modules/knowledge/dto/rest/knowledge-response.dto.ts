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

  // In the RESPONSE rather than only in a log: a caller that cannot tell
  // degraded results from normal ones presents them as normal ones, and "the
  // search got worse" then gets reported as a quality problem, not a billing one.
  /**
   * Why this result set is thinner than usual, or `null` when it is not.
   *
   * `LEXICAL_ONLY` means the vector search was skipped.
   */
  degraded!: 'LEXICAL_ONLY' | null;
}

export class RetrievedChunkDto {
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
  chunks!: RetrievedChunkDto[];

  /**
   * Why this result set is thinner than usual, or null when it is not.
   *
   * Present in the RESPONSE rather than only in a log, because a caller that
   * cannot tell degraded results from normal ones will present them as normal
   * ones — and "the search got worse" is then reported as a quality problem
   * rather than as a billing one.
   */
  degraded!: 'LEXICAL_ONLY' | null;
}

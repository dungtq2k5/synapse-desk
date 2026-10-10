import { PaginationMetaDataResponseDto } from '../../../../common/dto/rest/pagination-response.dto';

/**
 * One article, as an end user sees it.
 *
 * **Four fields, and the absences are the point.** `fileUrl`, `fileHash`,
 * `fileSizeBytes`, `createdById`, `status` and the department links are all on
 * the document row and none of them reach here — the wire type is narrow, so
 * this DTO is not the only thing standing between an end user and them
 * (ADR 0031).
 */
export class KnowledgeArticleResponseDto {
  id!: string;
  title!: string;
  updatedAt!: Date;
  /** The only reading-length signal on this response, `fileSizeBytes` being absent. */
  chunkCount!: number;
}

/** One block of an article's text, in reading order. */
export class KnowledgeArticleBlockResponseDto {
  chunkIndex!: number;
  /** `null` for formats with no pages — never faked as 1. */
  pageNumber!: number | null;
  contentText!: string;
}

export class KnowledgeArticleDetailResponseDto {
  article!: KnowledgeArticleResponseDto;
  blocks!: KnowledgeArticleBlockResponseDto[];
  /**
   * Describes the BLOCK range, not a page of articles.
   *
   * A whole document is unbounded — a 200-page handbook is hundreds of blocks —
   * so the detail view pages through the text rather than returning it whole.
   */
  meta!: PaginationMetaDataResponseDto;
  /**
   * True when some of the source could not be read.
   *
   * The blocks are then less than the document, and nothing in them shows it —
   * `chunkIndex` is contiguous over what survived, so there is no gap to
   * notice. Render it as a notice rather than hiding the article: 197 readable
   * pages beat none, which is the trade indexing already made.
   */
  hasUnindexedPages!: boolean;
}

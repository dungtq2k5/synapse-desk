/**
 * Pagination envelope for list endpoints.
 */
export class PaginationMetaDataResponseDto {
  /** Total matching records, across every page. */
  totalItems!: number;

  /** Records on THIS page — smaller than `itemsPerPage` on the last one. */
  itemCount!: number;

  /** The requested page size. */
  itemsPerPage!: number;

  totalPages!: number;

  currentPage!: number;
}

export class PaginationResponseDto<T> {
  items!: T[];

  meta!: PaginationMetaDataResponseDto;
}

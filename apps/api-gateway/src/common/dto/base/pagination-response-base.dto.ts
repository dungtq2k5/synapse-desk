/**
 * Pagination envelope for list endpoints.
 */
export class PaginationMetaDataResponseBase {
  /** Total matching records, across every page. */
  totalItems!: number;

  /** Records on THIS page — smaller than `itemsPerPage` on the last one. */
  itemCount!: number;

  /** The requested page size. */
  itemsPerPage!: number;

  totalPages!: number;

  currentPage!: number;
}

export class PaginationResponseBase<T> {
  items!: T[];

  meta!: PaginationMetaDataResponseBase;
}

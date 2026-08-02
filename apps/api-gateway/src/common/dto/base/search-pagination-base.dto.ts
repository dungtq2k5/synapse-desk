import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  DEFAULT_SEARCH,
  SORT_ORDER_OPTIONS,
  type SortOrder,
} from '@synapsedesk/common';

export class SearchPaginationBase {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  // Guaranteed that this query will always be provided even if the client does not provide it
  page: number = DEFAULT_SEARCH.PAGE;

  @IsOptional()
  @IsInt()
  @Min(DEFAULT_SEARCH.MIN_LIMIT)
  @Max(DEFAULT_SEARCH.MAX_LIMIT)
  @Type(() => Number)
  limit: number = DEFAULT_SEARCH.LIMIT;

  @IsOptional()
  @IsString()
  searchTerm?: string;

  /**
   * Default sort column. `createdAt` suits most resources, but NOT all —
   * `user_departments` has `assignedAt` and no `createdAt` at all — so a list
   * DTO whose resource differs MUST override this default.
   *
   * Getting it wrong is not a cosmetic problem: the service allowlists sortable
   * columns and rejects anything else with 400, so an unoverridden default
   * makes the endpoint fail on a request with NO query parameters at all —
   * i.e. every default call from the UI.
   */
  @IsOptional()
  @IsString()
  sortBy: string = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsString()
  @IsIn(SORT_ORDER_OPTIONS)
  sortOrder: SortOrder = DEFAULT_SEARCH.SORT_ORDER;
}

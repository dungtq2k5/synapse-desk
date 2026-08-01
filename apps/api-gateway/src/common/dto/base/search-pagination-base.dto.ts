import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  DEFAULT_SEARCH,
  SORT_ORDER_OPTIONS,
  type SortOrder,
} from '../../config/app.config';

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

  @IsOptional()
  @IsString()
  sortBy: string = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsString()
  @IsIn(SORT_ORDER_OPTIONS)
  sortOrder: SortOrder = DEFAULT_SEARCH.SORT_ORDER;
}

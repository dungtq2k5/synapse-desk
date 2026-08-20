import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DEFAULT_SEARCH, trimIfString } from '@synapsedesk/common';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import {
  DEFAULT_KNOWLEDGE_SEARCH_LIMIT,
  MAX_KNOWLEDGE_QUERY_LENGTH,
  MAX_KNOWLEDGE_QUESTION_LENGTH,
  MAX_KNOWLEDGE_SEARCH_LIMIT,
} from '../../../../common/config/dto.config';

/**
 * One question, and deliberately nothing else.
 *
 * **`ChatRequest.history` is NOT exposed here.** `/knowledge/ask` is one-shot,
 * and a client able to pass history would get a multi-turn conversation metered
 * as `CHAT_ANSWER` with `ticket_id = NULL` — an unbounded thread outside any
 * ticket, which is the opposite of the attribution this surface exists to give.
 * Omitting the field makes that structural rather than conventional.
 */
export class KnowledgeAskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_KNOWLEDGE_QUESTION_LENGTH)
  @Transform(trimIfString)
  message!: string;
}

export class KnowledgeSearchDto {
  @IsString()
  @MinLength(1)
  // Bounded here as well as at the retriever. A 50,000-character "query" is
  // one embedding call charged to the tenant that could never have matched
  // anything — cheaper to refuse at the edge than to meter.
  @MaxLength(MAX_KNOWLEDGE_QUERY_LENGTH)
  @Transform(trimIfString)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  // `@Min(0)`, not `@Min(1)`: the default below IS zero, and `@IsOptional()`
  // only skips a value that is `undefined` or `null` -- so a floor of 1 would
  // reject every request that simply omits the field.
  @Min(0)
  @Max(MAX_KNOWLEDGE_SEARCH_LIMIT)
  @ApiPropertyOptional()
  limit: number = DEFAULT_KNOWLEDGE_SEARCH_LIMIT;

  /**
   * Returns what the RETRIEVER found, before the reranker had an opinion.
   *
   * A diagnostic rather than a performance switch: a Knowledge Manager asking
   * "why isn't this document coming back" needs to know whether it lost at
   * retrieval or at rerank, and those are different problems with different
   * fixes.
   */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  @ApiPropertyOptional()
  skipRerank: boolean = false;
}

/**
 * Query for `GET /knowledge/articles`.
 *
 * `sortBy` is overridden because the base default is `createdAt` and the
 * service allowlists `updatedAt` and `title` — left alone, the help centre's
 * first page load, which sends no query parameters at all, would 400.
 *
 * `?search=` is HONOURED here, over titles. It is the first thing an end user
 * reaches for, and a filter that is advertised and dropped answers a different
 * question than the one asked.
 */
export class ListKnowledgeArticlesQueryDto extends SearchPaginationDto {
  override sortBy: string = 'updatedAt';
}

/**
 * Query for `GET /knowledge/articles/:id` — a range of BLOCKS.
 *
 * **Does NOT extend `SearchPaginationDto`**, and that is the point. The base
 * carries `searchTerm` and `sortBy`, and neither means anything here: the
 * blocks ARE the document in `chunkIndex` order, and re-sorting or filtering
 * them would scramble what the reader is paging through. Inheriting them would
 * advertise two filters this route silently drops — the defect five DTOs in
 * this codebase already have, and this one declines to be the sixth.
 */
export class KnowledgeArticleBlocksQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @ApiPropertyOptional()
  readonly page: number = DEFAULT_SEARCH.PAGE;

  @IsOptional()
  @IsInt()
  @Min(DEFAULT_SEARCH.MIN_LIMIT)
  @Max(DEFAULT_SEARCH.MAX_LIMIT)
  @Type(() => Number)
  @ApiPropertyOptional()
  readonly limit: number = DEFAULT_SEARCH.LIMIT;
}

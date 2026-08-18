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
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import {
  DEFAULT_KNOWLEDGE_SEARCH_LIMIT,
  MAX_KNOWLEDGE_QUERY_LENGTH,
  MAX_KNOWLEDGE_SEARCH_LIMIT,
} from '../../../../common/config/dto.config';

export class KnowledgeSearchDto {
  @IsString()
  @MinLength(1)
  // Bounded here as well as at the retriever. A 50,000-character "query" is
  // one embedding call charged to the tenant that could never have matched
  // anything — cheaper to refuse at the edge than to meter.
  @MaxLength(MAX_KNOWLEDGE_QUERY_LENGTH)
  @Transform(({ value }: { value: string }) => value?.trim())
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

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

export class KnowledgeSearchDto {
  @IsString()
  @MinLength(1)
  // Bounded here as well as at the retriever. A 50,000-character "query" is
  // one embedding call charged to the tenant that could never have matched
  // anything — cheaper to refuse at the edge than to meter.
  @MaxLength(1_000)
  @Transform(({ value }: { value: string }) => value?.trim())
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * Returns what the RETRIEVER found, before the reranker had an opinion.
   *
   * A diagnostic rather than a performance switch: a Knowledge Manager asking
   * "why isn't this document coming back" needs to know whether it lost at
   * retrieval or at rerank, and those are different problems with different
   * fixes.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipRerank?: boolean;
}

import { ArgsType, Field, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { DEFAULT_SEARCH } from '@synapsedesk/common';

/**
 * The pagination arguments every list query takes.
 *
 * **`first` carries no `@Max`, deliberately** — 25-doc §5. It is CLAMPED to
 * `MAX_PAGE_SIZE` by `toPageQuery` in `common/mappers/pagination.mapper.ts`, and
 * a validator here would turn that clamp into the rejection it exists to
 * replace — making the cap a breaking change for a client that worked
 * yesterday.
 *
 * The cap is named rather than linked because this file no longer imports it:
 * the clamp moved out with the mapper, and an import kept alive only by a doc
 * reference is one a lint sweep eventually deletes without reading the sentence
 * that needed it.
 */
@ArgsType()
export class PageArgsGqlDto {
  @Field(() => Int, { defaultValue: DEFAULT_SEARCH.PAGE })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = DEFAULT_SEARCH.PAGE;

  @Field(() => Int, { defaultValue: DEFAULT_SEARCH.LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  first: number = DEFAULT_SEARCH.LIMIT;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  searchTerm?: string;
}

import { ArgsType, Field, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { DEFAULT_SEARCH } from '@synapsedesk/common';

/**
 * The pagination arguments every list query takes.
 *
 * **`first` carries no `@Max`, deliberately**. It is CLAMPED to
 * `MAX_PAGE_SIZE` by `toPageQuery` in `common/graphql/page-query.ts`, and
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
  readonly page: number = DEFAULT_SEARCH.PAGE;

  @Field(() => Int, { defaultValue: DEFAULT_SEARCH.LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  // No `@Max`: `toPageQuery` CLAMPS this to `MAX_PAGE_SIZE` rather than
  // rejecting it. A validator here would turn the clamp into the 400 it exists
  // to replace -- asking for 10,000 rows should return the first hundred, not
  // fail the query.
  readonly first: number = DEFAULT_SEARCH.LIMIT;
}

/**
 * `PageArgsGqlDto` plus a free-text search term.
 *
 * **The GraphQL half of the same split `SearchPaginationDto` makes on REST**,
 * and made for the same reason. `searchTerm` used to live on the base, so
 * `IngestionJobsArgsGqlDto` inherited it: `Query.ingestionJobs(searchTerm:)`
 * was published in the schema, validated, forwarded through `toPageQuery` and
 * then ignored by ingestion-service (known-gaps #6). The REST route refuses it
 * now, and a base that kept handing it to every subclass would leave GraphQL
 * advertising exactly what REST answers with a 400.
 *
 * A subclass opts IN by extending this, rather than opting out of a capability
 * the base asserted — which is the direction `IngestionJobsArgsGqlDto`'s own
 * docblock names as the one people drift in: *"a filter the REST list cannot
 * express would be a second query surface with different capabilities."*
 */
@ArgsType()
export class SearchPageArgsGqlDto extends PageArgsGqlDto {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  readonly searchTerm?: string;
}

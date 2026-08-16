import { PageMeta } from '@synapsedesk/grpc-proto';
import { DEFAULT_SEARCH, SortOrder } from '@synapsedesk/common';
import { PaginationMetaDataResponseDto } from '../dto/rest/pagination-response.dto';
import { PageArgsGqlDto } from '../dto/graphql/page-args.gql-dto';
import { MAX_PAGE_SIZE } from '../config/graphql-limits.config';

/**
 * Wire `PageMeta` -> REST envelope.
 *
 * A field-for-field copy: `PageMeta` was defined with exactly these names so
 * this stays a rename-free translation, and so adding a field to one end is a
 * compile error at the other rather than a silently missing key.
 */
export function toPaginationMetaDataResponseDto(
  meta: PageMeta | undefined,
): PaginationMetaDataResponseDto {
  // ts-proto types every message-valued field as `T | undefined`. That is its
  // convention for message fields, not permission for a list RPC to omit its
  // meta — so a missing one is a contract violation and should say so rather
  // than be papered over with zeroes that render as "0 results".
  if (!meta) {
    throw new Error('Received a paginated response without meta');
  }

  return {
    totalItems: meta.totalItems,
    itemCount: meta.itemCount,
    itemsPerPage: meta.itemsPerPage,
    totalPages: meta.totalPages,
    currentPage: meta.currentPage,
  };
}

/**
 * GraphQL page arguments -> the query a gRPC client takes, `first` CLAMPED.
 *
 * **Here rather than beside `PageArgsGqlDto`**, for the reason the module
 * already settled for `toUserSummaryGqlDto`: every wire/transport translation in
 * this gateway lives in a `*.mapper.ts`, and a mapper in a DTO file is local
 * consistency that reads wrong across the codebase. It sits beside
 * {@link toPaginationMetaDataResponseDto} because the two are the same subject from opposite
 * ends — one turns a page request into a query, the other turns the page
 * response back into an envelope.
 *
 * Not in `graphql.config.ts`: that builds the Apollo driver options once at
 * boot. This runs per request, and putting it there would make "configuration"
 * mean two unrelated things.
 *
 * **Generic in `sortBy`, and `sortOrder` is annotated rather than `satisfies`.**
 * Both details are load-bearing, and both were type errors before:
 *
 *   - Without the type parameter, `sortBy`'s type is inferred from the default
 *     — and because `DEFAULT_SEARCH` is a const object, that literal does not
 *     widen, so the parameter's type was the single value `'createdAt'` and
 *     `toPageQuery(args, 'name')` did not compile. The call site papered over it
 *     with `as never`, which casts the RESULT and leaves the argument as broken
 *     as it was.
 *   - `'DESC' satisfies SortOrder` checks the value but still widens to `string`
 *     inside a mutable object literal, so the returned `sortOrder` did not
 *     satisfy any query DTO's `'ASC' | 'DESC'`.
 *
 * Neither surfaced at runtime: ts-jest transpiles without typechecking, so the
 * e2e suite passed over both.
 *
 * The clamp is here rather than a `@Max` on the argument A
 * validator would turn the clamp into the rejection it exists to replace.
 */
export function toPageQuery<
  SortBy extends string = typeof DEFAULT_SEARCH.SORT_BY,
>(args: PageArgsGqlDto, sortBy: SortBy = DEFAULT_SEARCH.SORT_BY as SortBy) {
  return {
    page: args.page,
    limit: Math.min(args.first, MAX_PAGE_SIZE),
    searchTerm: args.searchTerm,
    sortBy,
    sortOrder: 'DESC' as SortOrder,
  };
}

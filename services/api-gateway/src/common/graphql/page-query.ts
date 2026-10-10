import { DEFAULT_SEARCH, SortOrder } from '@synapsedesk/common';
import {
  PageArgsGqlDto,
  SearchPageArgsGqlDto,
} from '../dto/graphql/page-args.gql-dto';
import { MAX_PAGE_SIZE } from '../config/graphql-limits.config';

/**
 * GraphQL page arguments -> the query a service takes, `first` CLAMPED.
 *
 * Binding a request rather than mapping a response, which is why it is here and
 * not in `common/mappers/`: a resolver may call this for the same reason a REST
 * controller may bind a query DTO.
 *
 * @example
 * const page = await this.users.listGql(toPageQuery(args), context);
 *
 * @example
 * // Sorting on a different column:
 * const page = await this.departments.list(toPageQuery(args, 'name'), context);
 *
 * @param args - the page arguments the resolver received, with or without a
 *   search term: `searchTerm` lives on `SearchPageArgsGqlDto` alone, so a
 *   resolver whose service does not filter cannot accidentally forward one
 * @param sortBy - the column to sort on; defaults to `DEFAULT_SEARCH.SORT_BY`
 * @returns a query object accepted by the list methods on a gateway service
 */
export function toPageQuery<
  SortBy extends string = typeof DEFAULT_SEARCH.SORT_BY,
>(
  args: PageArgsGqlDto | SearchPageArgsGqlDto,
  sortBy: SortBy = DEFAULT_SEARCH.SORT_BY as SortBy,
) {
  return {
    page: args.page,
    limit: Math.min(args.first, MAX_PAGE_SIZE),
    // `in` rather than an optional read: `searchTerm` is not on the base at
    // all since the split, so a resolver on `PageArgsGqlDto` has nothing to
    // forward — which is the point. `undefined` here is the same value the
    // field carried when a caller omitted it, so services are unchanged.
    searchTerm: 'searchTerm' in args ? args.searchTerm : undefined,
    sortBy,

    // Annotated, NOT `satisfies`: `'DESC' satisfies SortOrder` widens to
    // `string` inside a mutable object literal, and the result then satisfies
    // no query DTO's `'ASC' | 'DESC'`. ts-jest transpiles without typechecking,
    // so this does not surface at runtime.
    sortOrder: 'DESC' as SortOrder,
  };
}

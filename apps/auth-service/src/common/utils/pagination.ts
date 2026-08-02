import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  clampLimit,
  fromProtoSortOrder,
  normalizePage,
  PageRequest,
  SortOrder,
} from '@synapsedesk/grpc-proto';

/** What Prisma needs to execute a paged, sorted query. */
export type PrismaPage = {
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'>;
};

/**
 * Turns a wire `PageRequest` into Prisma arguments, validating `sortBy` against
 * an allowlist the calling module owns.
 *
 * **The allowlist is not optional.** `sortBy` reaches `orderBy: { [sortBy]: … }`
 * as a raw string; an arbitrary value there either blows up as a Prisma
 * validation error at query time or sorts by a column that was never meant to
 * be observable — and sort order over a column IS an information channel
 * (ordering users by `passwordHash` leaks the ordering of the hashes).
 *
 * An unknown field is rejected with INVALID_ARGUMENT rather than falling back
 * to `createdAt`. A silent fallback hides the client bug forever; a 400 gets it
 * fixed on day one.
 *
 * `limit` is clamped HERE as well as at the REST edge. This service is
 * reachable from other services over gRPC, where no ValidationPipe ever ran, so
 * the gateway's validation is not a guarantee this side can rely on.
 */
export function toPrismaPage(
  page: PageRequest,
  sortable: readonly string[],
): PrismaPage {
  const sortBy = page.sortBy || sortable[0];

  if (!sortable.includes(sortBy)) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      // Names the legal values: a caller that guessed wrong can fix it from the
      // error alone rather than reading the source.
      message: `Cannot sort by '${sortBy}'. Sortable fields: ${sortable.join(', ')}`,
    });
  }

  const limit = clampLimit(page.limit);
  const currentPage = normalizePage(page.page);

  return {
    skip: (currentPage - 1) * limit,
    take: limit,
    orderBy: {
      [sortBy]: fromProtoSortOrder(page.sortOrder) === 'ASC' ? 'asc' : 'desc',
    },
  };
}

/**
 * The `contains` filter for a free-text search, or `undefined` when the caller
 * sent nothing.
 *
 * Returning `undefined` rather than `{ contains: '' }` matters: an empty
 * `contains` matches every row, so it is harmless here, but it also defeats any
 * index the column has and turns a cheap lookup into a scan on every unfiltered
 * list request.
 */
export function toSearchFilter(
  searchTerm: string,
): { contains: string; mode: 'insensitive' } | undefined {
  const term = searchTerm.trim();
  if (!term) return undefined;

  return { contains: term, mode: 'insensitive' };
}

/**
 * A PageRequest with every field at its proto3 zero value.
 *
 * ts-proto types message-valued fields as `T | undefined`, so a caller that
 * omits `page` entirely is representable — and every list RPC needs the same
 * fallback. This lived as a private copy in four services, which is three more
 * chances for one of them to drift into a different default.
 *
 * Zeroes rather than DEFAULT_SEARCH values on purpose: `toPrismaPage` already
 * reads 0 as "unset" and applies the defaults, so duplicating them here would
 * create a second place for the default page size to be wrong.
 */
export function emptyPage(): PageRequest {
  return {
    page: 0,
    limit: 0,
    searchTerm: '',
    sortBy: '',
    sortOrder: SortOrder.SORT_ORDER_UNSPECIFIED,
  };
}

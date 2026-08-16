import { DEFAULT_SEARCH, type SortOrder } from '@synapsedesk/common';
import {
  PageMeta,
  PageRequest,
  SortOrder as ProtoSortOrder,
} from '../generated/synapsedesk/auth/common';

/**
 * The subset of the gateway's `SearchPaginationBase` that crosses the wire.
 *
 * Declared structurally rather than importing the DTO: `SearchPaginationBase`
 * is a class decorated with class-validator, which lives at the REST edge and
 * has no business being pulled into a proto library that auth-service also
 * imports. Every list query DTO extends that base, so it satisfies this shape
 * by construction.
 */
export type PageQuery = {
  page: number;
  limit: number;
  searchTerm?: string;
  sortBy: string;
  sortOrder: SortOrder;
};

/**
 * REST query DTO -> wire.
 *
 * `searchTerm` collapses to '' rather than staying undefined: proto3 scalars
 * have no null, and `defaults: true` in GRPC_LOADER_OPTIONS would materialize
 * an omitted field as '' on the receiving side anyway. Doing it here makes the
 * two ends agree explicitly instead of by accident.
 */
export function toPageRequest(query: PageQuery): PageRequest {
  return {
    page: query.page,
    limit: query.limit,
    searchTerm: query.searchTerm ?? '',
    sortBy: query.sortBy,
    sortOrder: toProtoSortOrder(query.sortOrder),
  };
}

/**
 * Builds the response envelope from what the query actually returned.
 *
 * `itemCount` is the length of THIS page and `totalItems` the size of the whole
 * result set — they differ on the last page, and conflating them is what makes
 * a paginator show the wrong number of pages.
 */
export function toPageMeta(
  page: PageRequest,
  totalItems: number,
  itemCount: number,
): PageMeta {
  const limit = clampLimit(page.limit);

  return {
    totalItems,
    itemCount,
    itemsPerPage: limit,
    totalPages: Math.ceil(totalItems / limit),
    currentPage: normalizePage(page.page),
  };
}

/**
 * Clamps a requested page size into [MIN_LIMIT, MAX_LIMIT].
 *
 * Exported because auth-service must apply it too. The gateway DTO already
 * validates the range, but a service is reachable from other services over
 * gRPC where no ValidationPipe ever ran — an unclamped `take` there is an
 * unbounded query, which is a denial of service with extra steps.
 *
 * A zero limit (proto3's default for an omitted int32) reads as "the caller did
 * not set one", so it takes the default rather than returning an empty page
 * forever.
 */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_SEARCH.LIMIT;

  return Math.min(
    Math.max(limit, DEFAULT_SEARCH.MIN_LIMIT),
    DEFAULT_SEARCH.MAX_LIMIT,
  );
}

/** Same reasoning as clampLimit: 0 means "unset", and page numbers are 1-based. */
export function normalizePage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return DEFAULT_SEARCH.PAGE;

  return Math.floor(page);
}

/**
 * Two types share the name `SortOrder` and they are NOT interchangeable: the
 * shared domain one is a string ('ASC'), the proto one is numeric (1). These
 * two functions are the only sanctioned bridge — same arrangement as Gender
 * and OtpPurpose.
 */
const PROTO_SORT_ORDER_BY_DOMAIN: Record<SortOrder, ProtoSortOrder> = {
  ASC: ProtoSortOrder.SORT_ORDER_ASC,
  DESC: ProtoSortOrder.SORT_ORDER_DESC,
};

export function toProtoSortOrder(sortOrder: SortOrder): ProtoSortOrder {
  return (
    PROTO_SORT_ORDER_BY_DOMAIN[sortOrder] ?? ProtoSortOrder.SORT_ORDER_DESC
  );
}

/**
 * UNSPECIFIED means the caller omitted the field, which takes the default
 * rather than being rejected — direction is a presentation preference, not
 * something a request is wrong without. UNRECOGNIZED (-1), a member added by a
 * newer build than this one, lands in the same place.
 */
export function fromProtoSortOrder(sortOrder: ProtoSortOrder): SortOrder {
  if (sortOrder === ProtoSortOrder.SORT_ORDER_ASC) return 'ASC';
  if (sortOrder === ProtoSortOrder.SORT_ORDER_DESC) return 'DESC';

  return DEFAULT_SEARCH.SORT_ORDER;
}

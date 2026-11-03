/**
 * The `PageRequest` fixture builder.
 *
 * Here rather than beside the `CallerContext` builders in
 * `@synapsedesk/testing/context` because it builds a PROTO message, and
 * `packages/testing` depends on `packages/contracts` alone; giving it
 * `grpc-proto` would make every service's test helpers carry the wire.
 *
 * **Test-only**: `tsconfig.build.json` excludes `src/testing`, so nothing here
 * reaches `dist`.
 */

import { SortOrder } from '../generated/synapsedesk/auth/common';
import type { PageRequest } from '../generated/synapsedesk/auth/common';

/**
 * A `PageRequest` with every field set.
 *
 * Every list RPC nests one, and every field is non-optional on the wire —
 * proto3 scalars have no null, so "no filter" is the empty string rather than
 * an absent key. Omitting one produces `undefined.trim()` deep inside the
 * pagination helper, which reads as a service bug rather than a malformed
 * request.
 */
export function pageRequest(overrides: Partial<PageRequest> = {}): PageRequest {
  return {
    page: 1,
    limit: 50,
    searchTerm: '',
    sortBy: '',
    // The proto zero value: "the caller did not choose", which takes the
    // service default rather than being rejected.
    sortOrder: SortOrder.SORT_ORDER_UNSPECIFIED,
    ...overrides,
  };
}

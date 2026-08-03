import { faker } from '@faker-js/faker';
import { SortOrder } from '@synapsedesk/grpc-proto';
import type { CallerContext, PageRequest } from '@synapsedesk/grpc-proto';
import type { PermissionCode, RequestOrigin } from '@synapsedesk/common';

/**
 * The caller context a service method would receive from the gateway.
 *
 * Built here rather than in each suite because the e2e layer bypasses
 * the gRPC hop entirely — it calls services directly — so nothing constructs
 * this for it. Getting a field wrong (an `organizationId` that does not match
 * the fixture's tenant, say) makes `tenantScope()` filter everything out and
 * the test fails with an empty result and no hint why.
 */
export function callerContext(
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return {
    ip: faker.internet.ipv4(),
    userAgent: faker.internet.userAgent(),
    sub: faker.string.uuid(),
    organizationId: faker.string.uuid(),
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    ...overrides,
  };
}

/** Context for a specific member of a specific tenant. */
export function memberContext(
  user: { id: string; organizationId: string | null },
  permissionCodes: PermissionCode[] = [],
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return callerContext({
    sub: user.id,
    organizationId: user.organizationId,
    permissionCodes,
    ...overrides,
  });
}

/** A platform Super Admin: the flag AND a null tenant, exactly as the DB CHECK pairs them. */
export function superAdminContext(
  userId: string,
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return callerContext({
    sub: userId,
    organizationId: null,
    isSuperAdmin: true,
    ...overrides,
  });
}

/** A request with no identity — login, register, invitation preview. */
export function requestOrigin(
  overrides: Partial<RequestOrigin> = {},
): RequestOrigin {
  return {
    ip: faker.internet.ipv4(),
    userAgent: faker.internet.userAgent(),
    ...overrides,
  };
}

/**
 * A `PageRequest` with every field set.
 *
 * Every list RPC nests one, and every field is non-optional on the wire — proto3
 * scalars have no null, so "no filter" is the empty string rather than an absent
 * key. Omitting one in a fixture produces `undefined.trim()` deep inside
 * `toSearchFilter`, which reads as a service bug rather than a malformed
 * request.
 */
export function pageRequest(overrides: Partial<PageRequest> = {}): PageRequest {
  return {
    page: 1,
    limit: 50,
    searchTerm: '',
    sortBy: '',
    // The proto zero value: "the caller did not choose", which takes the
    // service default rather than being rejected. Direction is a presentation
    // preference, not something a request is wrong without.
    sortOrder: SortOrder.SORT_ORDER_UNSPECIFIED,
    ...overrides,
  };
}

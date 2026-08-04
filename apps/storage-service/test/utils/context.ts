import { faker } from '@faker-js/faker';
import type {
  CallerContext,
  PermissionCode,
  RequestOrigin,
} from '@synapsedesk/common';

/**
 * The caller context a service method would receive from the gateway.
 *
 * Built here rather than in each suite because the e2e layer bypasses the gRPC
 * hop entirely — it calls services directly — so nothing constructs this for
 * it. Getting a field wrong (an `organizationId` that does not match the
 * fixture's tenant) makes `tenantScope()` filter everything out, and the test
 * fails with an empty result and no hint why.
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

/** A member of a specific tenant, holding specific permissions. */
export function memberContext(
  user: { id: string; organizationId: string },
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

/** A platform Super Admin: the flag AND a null tenant, exactly as paired. */
export function superAdminContext(
  userId: string = faker.string.uuid(),
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return callerContext({
    sub: userId,
    organizationId: null,
    isSuperAdmin: true,
    ...overrides,
  });
}

/** A request with no identity. */
export function requestOrigin(
  overrides: Partial<RequestOrigin> = {},
): RequestOrigin {
  return {
    ip: faker.internet.ipv4(),
    userAgent: faker.internet.userAgent(),
    ...overrides,
  };
}

/**
 * The `CallerContext` builders every service's e2e suite needs.
 *
 * Duplicated in many services with only cosmetic drift between them — three
 * distinct copies of the same sixty lines, differing in comment wording and in
 * two signatures that had quietly diverged.
 *
 * Here rather than in `grpc-proto` because these build DOMAIN types
 * (`CallerContext`, `PermissionCode`, `RequestOrigin`), all of which live in
 * this library. `pageRequest` is the one helper that could not come along: it
 * builds a proto message, and `common` importing `grpc-proto` would invert the
 * dependency between them. It lives in `@synapsedesk/grpc-proto/testing/page`.
 *
 * **Test-only**: excluded from this library's build (`tsconfig.build.json`),
 * so nothing here reaches `dist`.
 */

import { faker } from '@faker-js/faker';
import type { CallerContext, PermissionCode, RequestOrigin } from '../main';

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

/**
 * A member of a specific tenant, holding specific permissions.
 *
 * `organizationId` is `string | null` — the wider of the two signatures that
 * had drifted. auth-service needs null (its fixtures include users with no
 * tenant); the others always pass a string, which this still accepts. Narrowing
 * it would break auth-service; widening it costs the others nothing.
 */
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

/**
 * A platform Super Admin: the flag AND a null tenant, exactly as the database
 * CHECK constraint pairs them.
 *
 * The id defaults, taking the more convenient of the two drifted signatures —
 * most callers do not care which id a Super Admin has, and the ones that do
 * still pass it.
 */
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

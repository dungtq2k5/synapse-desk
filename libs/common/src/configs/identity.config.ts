/**
 * @file Who is calling — JWT payload shapes, the caller context services act under,
 * and the metadata keys that carry it across a service hop.
 *
 * The distinction this file exists to keep sharp: `JwtPayload` is what the
 * gateway VERIFIED, `CallerContext` is what a service is TOLD, and the nullable
 * fields on the latter are why a service must check for an identity rather than
 * assume one.
 */

import type { PermissionCode } from './rbac.config';

export type JwtPayload = {
  sub: string;
  organizationId: string | null;
  isSuperAdmin: boolean;
  departmentIds: string[];
  permissionCodes: PermissionCode[];

  /**
   * Carried in the token so `EmailVerifiedGuard` can gate a route without a
   * round trip to auth-service on every request.
   *
   * The trade-off is staleness: the claim is only as fresh as the access token,
   * so a user who has just verified keeps the old value until the token
   * rotates. That is why verifying tells the client to call `POST /auth/refresh`
   * — the rotation is what picks up the new claim.
   */
  isEmailVerified: boolean;
};

export type TwoFactorJwtPayload = Pick<JwtPayload, 'sub'> & {
  is2faPending: true;
};

/**
 * Short-lived proof that a set of user ids has ALREADY passed a password check.
 *
 * Issued when one address + password matches accounts in several tenants. It is
 * what stops `POST /auth/login/tenant` from being an unauthenticated "which
 * tenants own this address?" oracle: without it that endpoint would accept any
 * organizationId for any address.
 *
 * `purpose` is the discriminant that keeps it distinct from a 2FA challenge —
 * the same job `is2faPending` does for TwoFactorJwtPayload, and necessary
 * because both are signed by the same pre-auth keypair.
 */
export type TenantSelectionJwtPayload = {
  userIds: string[];
  purpose: 'tenant_selection';
};

/**
 * What Passport may have written to `req.user` — which depends on WHICH strategy
 * authorized the route, so only `sub` is guaranteed.
 *
 * The 2FA challenge token is a genuinely different shape: no organization, no
 * departments, no permission codes, because a caller mid-challenge has none.
 * Declaring `req.user` as a full `JwtPayload` would let a half-authenticated
 * request be read as a complete one with silently empty permissions — which is
 * an authorization bypass, not a typing inconvenience.
 */
export type MaybeJwtPayload = Partial<JwtPayload> & {
  sub: string;
  is2faPending?: true;
};

/**
 * Narrows `req.user` to a fully authenticated caller.
 *
 * Checks for the ABSENCE of `is2faPending` rather than the presence of
 * `permissionCodes`: a legitimate user may hold zero permissions (the End User
 * role grants none), so presence-of-permissions is not the distinction.
 */
export function isFullJwtPayload(
  payload: MaybeJwtPayload | undefined,
): payload is MaybeJwtPayload & JwtPayload {
  return (
    payload !== undefined &&
    payload.is2faPending !== true &&
    payload.permissionCodes !== undefined &&
    payload.departmentIds !== undefined
  );
}

export type RequestContext = JwtPayload & {
  ip: string;
  userAgent: string;
};

/**
 * Where a request came from, as OBSERVED by the gateway rather than claimed by
 * the caller. The subset of RequestContext that exists even when nobody is
 * authenticated, which is why login and password-reset can carry it.
 *
 * Defined once here because auth-service writes it to `device_sessions` and
 * `password_reset_tokens`, and the gateway derives it from Express — three
 * copies of `Pick<RequestContext, 'ip' | 'userAgent'>` is three chances to
 * drift.
 */
export type RequestOrigin = Pick<RequestContext, 'ip' | 'userAgent'>;

/**
 * Provenance a service can trust, having been OBSERVED by the gateway rather
 * than claimed by the caller.
 *
 * The auth fields are nullable because the gateway calls auth-service before
 * anyone is authenticated — login, register, password reset and the public
 * invitation preview all travel with origin alone. A service that needs an
 * identity must therefore check for one; it may not assume it is there.
 * `hasIdentity` below, and `requireActor`/`requireTenant` in
 * `utils/tenant-scope.ts`, are what that check looks like.
 *
 * **Lives here rather than in `libs/grpc-proto`, where it started.** It is a
 * DOMAIN concept — who is calling — with no dependency on gRPC at all, and
 * `tenantScope()` needs it. Leaving it next to `packRequestContext` (which does
 * touch `Metadata` and therefore must stay in grpc-proto) would have forced
 * `libs/common` to import `libs/grpc-proto`, and grpc-proto already imports
 * common: a package cycle turbo's `dependsOn: ["^build"]` rejects outright.
 * grpc-proto re-exports both symbols, so every existing import site is
 * unchanged.
 */
export type CallerContext = RequestOrigin & {
  sub: string | null;
  organizationId: string | null;
  isSuperAdmin: boolean;
  departmentIds: string[];
  permissionCodes: PermissionCode[];
  isEmailVerified: boolean;
};

/**
 * The context a BACKGROUND JOB acts under.
 *
 * Background work has a tenant but no user: the ingestion worker embeds a
 * document on behalf of an organization, and the person who uploaded it is long
 * gone. `sub: null` states that honestly, which matters because it is what
 * makes `ai_generations.user_id` NULL for system work rather than attributing
 * spend to whoever happened to trigger it.
 *
 * **Deliberately NOT a super admin and holding NO permissions.** The temptation
 * is to give background jobs a bypass so they never hit an authorization edge;
 * the consequence is that a bug in a job runs with more authority than any real
 * user has. A job that needs to read across the tenant boundary is a job whose
 * design should be questioned, and it should fail loudly rather than succeed
 * quietly.
 */
export function systemContext(organizationId: string): CallerContext {
  return {
    sub: null,
    organizationId,
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    // Empty rather than null: `RequestOrigin` is what the gateway OBSERVED, and
    // there is no request to observe here. An audit row reading "" for a
    // background job is the truthful answer.
    ip: '',
    userAgent: '',
  };
}

/** Narrows to a caller with an identity. */
export function hasIdentity(
  context: CallerContext,
): context is CallerContext & { sub: string } {
  return context.sub !== null;
}

/**
 * gRPC metadata keys carrying RequestContext across a service hop.
 *
 * Metadata is stringly-typed: a typo on either side does not fail, it silently
 * yields an empty string and the audit row is quietly wrong. Sharing the keys
 * as constants is what makes that a compile error instead.
 */
export const GRPC_CONTEXT_METADATA = {
  userId: 'user_id',
  organizationId: 'organization_id',
  isSuperAdmin: 'is_super_admin',
  departmentIds: 'department_ids',
  permissionCodes: 'permission_codes',
  isEmailVerified: 'is_email_verified',
  ip: 'ip_address',
  userAgent: 'user_agent',
} as const;

/**
 * Stand-in for provenance we genuinely do not have — a notification triggered
 * by a background job or an already-authenticated action where the device is not
 * the point.
 *
 * Frozen and shared rather than an inline `{ ip: '', userAgent: '' }` default:
 * an inline literal allocates on every call and is mutable, so anything
 * downstream could modify what the signature presents as a constant.
 */
// `Object.freeze`, NOT `as const`. `as const` is erased at compile time: it
// narrows the type and leaves the object mutable, so any consumer of this
// SHARED value could still write to it and change what every other caller
// sees. Freezing is the runtime half the annotation cannot provide.
export const UNKNOWN_ORIGIN: Readonly<RequestOrigin> = Object.freeze({
  ip: '',
  userAgent: '',
});

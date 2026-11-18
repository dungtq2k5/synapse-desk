import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { CallerContext, hasIdentity } from '@synapsedesk/contracts';

/** The filter every tenant-scoped query starts from. */
export type TenantScope = {
  organizationId?: string;
  deletedAt: null;
};

/**
 * The tenant filter every tenant-scoped query starts from, in EVERY service.
 *
 * A Super Admin (`organizationId === null`) legitimately reads across tenants,
 * so for them the filter collapses to soft-delete only. That branch must never
 * be reachable by a tenant user, which is why it keys off the VERIFIED context
 * the gateway packed into gRPC metadata rather than anything in the request.
 *
 * Rules that go with it:
 *
 *   - **Every** `findMany`/`count` spreads `...tenantScope(ctx)`.
 *   - **Every** single-row read by id uses
 *     `findFirst({ where: { id, ...tenantScope(ctx) } })`, never
 *     `findUnique({ where: { id } })`. `findUnique` CANNOT express the tenant
 *     filter — its `where` accepts only unique fields — so it returns another
 *     tenant's row and the handler happily 200s it. This is the single most
 *     likely security bug in any service owning tenant-scoped rows.
 *   - A miss returns NOT_FOUND, never PERMISSION_DENIED: "you may not see this"
 *     confirms the row exists, turning id enumeration into a membership oracle.
 */
export function tenantScope(context: CallerContext): TenantScope {
  // A person only: row visibility can turn on who is asking (a ticket's
  // author, a document's departments), and a background job is nobody. A job
  // that needs its tenant reads it through `requireTenant`.
  if (!hasIdentity(context)) {
    // Reached when an RPC that needs an identity was called without one — i.e.
    // the gateway route is missing JwtAuthGuard. Failing here is the last line
    // of defence, and it must fail rather than return an unscoped filter.
    throw new RpcException({
      code: status.UNAUTHENTICATED,
      message: 'This operation requires an authenticated caller',
    });
  }

  if (context.isSuperAdmin) return { deletedAt: null };

  if (!context.organizationId) {
    // A non-super-admin with no organization violates the CHECK constraint on
    // users — (organization_id IS NULL) = is_super_admin. Something is wrong
    // with the token or the row, and either way an unscoped filter is the one
    // answer that must not be returned.
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'No tenant context',
    });
  }

  return { organizationId: context.organizationId, deletedAt: null };
}

/**
 * The caller's own tenant, for WRITES.
 *
 * Separate from `tenantScope` because a create needs a concrete
 * `organizationId`, and the Super Admin branch above deliberately has none.
 * A Super Admin creating a tenant-owned row must name the tenant explicitly
 * through `/platform/*`, not inherit it from a context that has none — which a
 * shared helper returning `string | undefined` would let them do by accident.
 */
export function requireTenant(context: CallerContext): string {
  if (!hasCaller(context)) {
    throw new RpcException({
      code: status.UNAUTHENTICATED,
      message: 'This operation requires an authenticated caller',
    });
  }

  if (!context.organizationId) {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'This operation is scoped to a tenant; use the platform API',
    });
  }

  return context.organizationId;
}

/**
 * Someone `requireTenant` can name a tenant for: a signed-in user, or a
 * background job acting for its tenant (`systemContext()`). `tenantScope` and
 * `requireActor` take only a user.
 */
function hasCaller(context: CallerContext): boolean {
  return hasIdentity(context) || context.isSystem === true;
}

/** The actor id for `created_by` / `deleted_by` / audit stamping. */
export function requireActor(context: CallerContext): string {
  if (!hasIdentity(context)) {
    throw new RpcException({
      code: status.UNAUTHENTICATED,
      message: 'This operation requires an authenticated caller',
    });
  }

  return context.sub;
}

/**
 * The actor id, or `null` for a background job (`systemContext()`, carried as
 * `is_system`). For the few checks a job legitimately reaches, such as
 * storage's export upload; everywhere else `requireActor` refuses a job.
 *
 * @example requireActorOrSystem(systemContext(orgId)) // null
 */
export function requireActorOrSystem(context: CallerContext): string | null {
  if (context.isSystem) return null;

  return requireActor(context);
}

/**
 * The request's `userId`, once it's proven the caller's own; otherwise
 * `NOT_FOUND`, with the text a missing user gets.
 *
 * For the RPCs that are only ever about the caller (their OTPs, their 2FA,
 * their profile) but name the user in the request: the gateway always sends
 * the caller's own id, and this holds a gRPC caller to the same. Another
 * user's id answers exactly as an id that doesn't exist.
 *
 * @example requireSelf(unpackCallerContext(metadata), request.userId)
 */
export function requireSelf(context: CallerContext, userId: string): string {
  if (!hasIdentity(context) || context.sub !== userId) {
    throw new RpcException({
      code: status.NOT_FOUND,
      message: 'User not found',
    });
  }

  return userId;
}

/**
 * Refuses anyone but a platform Super Admin, with `PERMISSION_DENIED`.
 *
 * The gateway's `SuperAdminGuard` already gates `/platform/*`; this is the
 * service holding the same line itself, so a gRPC caller that skips the
 * gateway can't read across tenants.
 *
 * @example requireSuperAdmin(unpackCallerContext(metadata))
 */
export function requireSuperAdmin(context: CallerContext): void {
  if (!context.isSuperAdmin) {
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'This operation is for platform Super Admins only',
    });
  }
}

/**
 * Refuses anyone but a background job (`systemContext()`), with
 * `PERMISSION_DENIED`. For the lookups that cross tenants by design and that
 * only jobs make, so a user's context never reaches them.
 *
 * @example requireSystem(unpackCallerContext(metadata))
 */
export function requireSystem(context: CallerContext): void {
  if (context.isSystem !== true) {
    throw new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'This lookup is for background jobs only',
    });
  }
}

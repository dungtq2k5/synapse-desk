import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { CallerContext, hasIdentity } from '@synapsedesk/grpc-proto';

/** The filter every tenant-scoped query starts from. */
export type TenantScope = {
  organizationId?: string;
  deletedAt: null;
};

/**
 * The tenant filter every Domain A query starts from.
 *
 * A Super Admin (`organizationId === null`) legitimately reads across tenants,
 * so for them the filter collapses to soft-delete only. That is exactly the
 * branch that must never be reachable by a tenant user — which is why it keys
 * off the VERIFIED context the gateway packed into gRPC metadata rather than
 * anything in the request body.
 *
 * Rules that go with it, and the reason each exists:
 *
 *   - **Every** `findMany`/`count` spreads `...tenantScope(ctx)`.
 *   - **Every** single-row read by id uses
 *     `findFirst({ where: { id, ...tenantScope(ctx) } })`, never
 *     `findUnique({ where: { id } })`. `findUnique` CANNOT express the tenant
 *     filter — its `where` accepts only unique fields — so it returns another
 *     tenant's row and the handler happily 200s it. This is the single most
 *     likely security bug in the remaining Domain A work.
 *   - A miss returns NOT_FOUND, never PERMISSION_DENIED. "You may not see this"
 *     confirms the row exists, which turns id enumeration into a
 *     tenant-membership oracle.
 */
export function tenantScope(context: CallerContext): TenantScope {
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
  if (!hasIdentity(context)) {
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

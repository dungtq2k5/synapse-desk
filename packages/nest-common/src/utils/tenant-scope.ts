import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { CallerContext, hasIdentity } from '@synapsedesk/contracts';

/**
 * The caller's own tenant, as a value or as a check.
 *
 * A create needs a concrete `organizationId`, and a Super Admin has none: a
 * Super Admin writing a tenant-owned row names the tenant explicitly through
 * `/platform/*`. **It is also the check that keeps a Super Admin off a tenant
 * route:** the scoped client is built through it, so every scoped query
 * refuses a Super Admin with `FAILED_PRECONDITION`.
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
 * background job acting for its tenant (`systemContext()`). `requireActor`
 * takes only a user.
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

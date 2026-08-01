import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '@synapsedesk/common';

export const PERMISSION_KEY = 'permission';

/**
 * Declares the permission(s) a route needs, enforced by `PermissionGuard`.
 *
 * Semantics are **ANY**, and the caller cannot see that from the call site — so
 * it is stated here:
 *
 *     @RequirePermission('ticket.update')                    // needs that one
 *     @RequirePermission('ticket.assign', 'ticket.assign.self') // needs EITHER
 *
 * For a route that genuinely needs two distinct grants, stack the guard twice
 * rather than relying on this decorator, so the conjunction stays visible.
 *
 * The `[PermissionCode, ...PermissionCode[]]` tuple makes a zero-argument call a
 * compile error: `@RequirePermission()` would otherwise set empty metadata, and
 * `PermissionGuard` treats empty as "no permission required" — silently opening
 * the route to every authenticated user.
 *
 * Requires `PermissionGuard` on the route (or globally). The decorator alone
 * enforces nothing.
 */
export const RequirePermission = (
  ...codes: [PermissionCode, ...PermissionCode[]]
) => SetMetadata(PERMISSION_KEY, codes);

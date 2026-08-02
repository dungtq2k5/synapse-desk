import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isFullJwtPayload } from '@synapsedesk/common';

/**
 * Gates `/platform/*`.
 *
 * **Not a permission check.** RBAC is tenant-scoped — `permissions` rows hang
 * off roles that belong to an organization — and a Super Admin has no
 * organization at all. There is no permission code that could express this, so
 * it keys off the JWT's `isSuperAdmin` claim, which a database CHECK constraint
 * keeps paired with `organization_id IS NULL`.
 *
 * Stack it as `@UseGuards(JwtAuthGuard, SuperAdminGuard)` at CLASS level, never
 * per method. One forgotten decorator on a `/platform/*` route is a full
 * cross-tenant breach, and a class-level guard covers routes added later by
 * default — which is the failure mode that actually happens.
 *
 * Requires an authenticating guard before it. Without one `req.user` is unset
 * and this raises 401 rather than silently admitting the request.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!isFullJwtPayload(user)) {
      throw new UnauthorizedException(
        'No authenticated caller — is JwtAuthGuard applied before SuperAdminGuard?',
      );
    }

    // BOTH conditions, not just the flag. The CHECK constraint keeps them in
    // step, but a token minted before a schema change — or by a bug — could
    // carry one without the other, and "is a super admin" is precisely the
    // claim where the wrong direction to fail is generous.
    if (!user.isSuperAdmin || user.organizationId !== null) {
      throw new ForbiddenException('Platform administration access required');
    }

    return true;
  }
}

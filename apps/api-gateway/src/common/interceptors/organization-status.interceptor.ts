import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { requestOf } from '../utils/execution-request.util';
import { Observable } from 'rxjs';
import {
  ORG_STATUS_ACCESS,
  OrgAccess,
  OrgStatus,
  isFullJwtPayload,
} from '@synapsedesk/common';
import { ORG_ACCESS_KEY } from '../decorators/org-access.decorator';
import { OrganizationStatusService } from '../organization-status/organization-status.service';

/**
 * Enforces the tenant lifecycle (api-endpoints-plan).
 *
 * Without this, setting a tenant to FROZEN changes a column and nothing else —
 * a button that appears to suspend a customer and does not. Every business
 * route now checks the owning tenant's status before dispatch.
 *
 * **An INTERCEPTOR rather than a global guard, and that is forced.** Global
 * guards run before route-level ones, so a global guard would execute before
 * `JwtAuthGuard` had populated `req.user` — it would have no tenant to check.
 * Interceptors run after all guards, which is exactly the ordering this needs.
 *
 * Three callers pass through untouched:
 *   - unauthenticated requests, which have no tenant yet;
 *   - Super Admins, who have no tenant at all (`organizationId IS NULL`) and
 *     must be able to act on a frozen one — that is the whole point of them;
 *   - routes marked `OrgAccess.AUTH`, so a member of a frozen tenant can still
 *     sign in and be TOLD why they cannot proceed, rather than meeting an
 *     unexplained 403 at the login form.
 */
@Injectable()
export class OrganizationStatusInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly organizationStatus: OrganizationStatusService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    // `requestOf`, not `switchToHttp()` — 25-doc. This is a GLOBAL interceptor,
    // so it runs on GraphQL operations too, where `switchToHttp()` returns an
    // empty object and `.user` throws. The lifecycle gate is exactly the kind of
    // thing that must not be transport-specific: a frozen tenant that can still
    // read through GraphQL is a suspension with a hole in it.
    const request = requestOf(context);
    // No request at all means no transport this gate understands, and therefore
    // no identity to gate on — the same answer as an unauthenticated call.
    if (!request) return next.handle();

    const user = request.user;

    // No identity yet (login, register, public invitation preview) — there is
    // no tenant to gate on.
    if (!isFullJwtPayload(user)) return next.handle();

    // A Super Admin belongs to no tenant, and acts ON frozen ones.
    if (user.isSuperAdmin || !user.organizationId) return next.handle();

    const kind = this.resolveKind(context, request);
    if (kind === OrgAccess.AUTH) return next.handle();

    const state = await this.organizationStatus.get(user.organizationId);

    if (state.deleted) {
      throw new ForbiddenException(
        'This workspace has been closed. Contact support if this is unexpected.',
      );
    }

    const allowed = ORG_STATUS_ACCESS[state.status] ?? [];
    if (!allowed.includes(kind)) {
      throw new ForbiddenException(explain(state.status));
    }

    return next.handle();
  }

  /**
   * The route's declared category, or one inferred from its verb.
   *
   * Inferring is what makes this safe by default: a route added tomorrow with
   * no decorator is still gated, and a WRITE at that — the stricter guess. An
   * allowlist of gated paths would have the opposite failure mode.
   */
  private resolveKind(context: ExecutionContext, request: Request): OrgAccess {
    const declared = this.reflector.getAllAndOverride<OrgAccess | undefined>(
      ORG_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (declared) return declared;

    return request.method === 'GET' || request.method === 'HEAD'
      ? OrgAccess.READ
      : OrgAccess.WRITE;
  }
}

/** Says which state the tenant is in and what to do about it. */
function explain(status: OrgStatus): string {
  switch (status) {
    case OrgStatus.SUSPENDED_PAST_DUE:
      return 'This workspace is suspended for non-payment. It is read-only until billing is settled.';
    case OrgStatus.FROZEN:
      return 'This workspace is frozen. Contact support to restore access.';
    case OrgStatus.PENDING_ONBOARDING:
      return 'This workspace has not finished onboarding yet.';
    default:
      return 'This workspace cannot perform that action in its current state.';
  }
}

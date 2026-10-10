import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../contexts/request.context';
import { requestOf } from '../utils/execution-request.util';
import {
  QUERY_PERMISSION_KEY,
  type QueryPermissionRule,
} from '../decorators/require-permission-for-query.decorator';

/** Enforces {@link RequirePermissionForQuery}. */
@Injectable()
export class QueryPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rules = this.reflector.getAllAndOverride<
      QueryPermissionRule[] | undefined
    >(QUERY_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!rules?.length) return true;

    // `requestOf`, not `switchToHttp()` — the same reason `PermissionGuard`
    // uses it: under GraphQL `switchToHttp()` returns an empty object and the
    // read below throws rather than failing honestly.
    const request = requestOf(context) as Request;
    const caller = RequestContextService.fromRequest(request);

    if (!caller) throw new UnauthorizedException('Authentication required');

    for (const rule of rules) {
      if (!isRequested(request, rule.query)) continue;

      // Super admins bypass, matching `PermissionGuard` — a rule enforced one
      // way in one guard and another way in its neighbour is the kind of
      // difference nobody discovers deliberately.
      if (caller.isSuperAdmin) continue;

      if (!caller.permissionCodes.includes(rule.permission)) {
        throw new ForbiddenException(
          `Using '${rule.query}' requires the ${rule.permission} permission`,
        );
      }
    }

    return true;
  }
}

/**
 * Whether the caller actually asked for the widening parameter.
 *
 * Read from the RAW query, because a guard runs before the `ValidationPipe` has
 * transformed `'true'` into `true` — so a `=== true` check here would pass
 * everybody and the guard would silently do nothing. Anything other than an
 * explicit false-ish value counts as asking.
 *
 * **A non-primitive counts as asking, deliberately.** Express parses
 * `?includeDeleted[x]=1` into an OBJECT and `?includeDeleted=a&includeDeleted=b`
 * into an array; stringifying either gives `'[object Object]'` or `'a,b'`,
 * neither of which is false-ish, so both would already demand the permission.
 * Saying so explicitly makes that the decision rather than a side effect of
 * coercion — and the safe direction for a guard is to demand the permission
 * when it cannot tell.
 */
function isRequested(request: Request, name: string): boolean {
  const value = (request.query as Record<string, unknown>)[name];

  if (value === undefined || value === null) return false;

  if (typeof value !== 'string' && typeof value !== 'number') return true;

  return !['false', '0', ''].includes(String(value).toLowerCase());
}

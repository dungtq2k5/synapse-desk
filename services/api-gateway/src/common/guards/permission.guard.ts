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
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { NodeEnv, PermissionCode } from '@synapsedesk/common';
import { ConfigService } from '@nestjs/config';
import { requestOf } from '../utils/execution-request.util';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly IS_PRODUCTION: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.IS_PRODUCTION =
      this.configService.getOrThrow<NodeEnv>('NODE_ENV') === 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    // `requestOf`, not `switchToHttp()`. This guard runs on
    // GraphQL too, where `switchToHttp()` returns an empty object and the read
    // below throws. The property that matters is that both transports are
    // guarded by the SAME code: a rule enforced on one and skipped on the other
    // is a rule with a hole in it that no test of either transport can see.
    const request = requestOf(context) as Request;
    const requestContext = RequestContextService.fromRequest(request);
    if (!requestContext) {
      throw new UnauthorizedException('Authentication required');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCode[]
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredPermissions?.length) return true; // No permission required

    if (requestContext.isSuperAdmin) return true; // Super admin bypasses permission checks

    // ANY, not ALL — `.some()`, matching what @RequirePermission documents and
    // what the message below says. It used to be `.every()` while reporting
    // "Requires one of", so a route listing two alternatives silently demanded
    // both, and the 403 explained the opposite of what had happened.
    //
    // ANY is the right default: multiple codes on one route means "either of
    // these roles may do this" (e.g. ticket.assign OR ticket.assign.self).
    // A route genuinely needing two distinct grants should stack two guards, so
    // the requirement is visible at the call site instead of hidden in here.
    const granted = requiredPermissions.some((code) =>
      requestContext.permissionCodes.includes(code),
    );
    if (!granted) {
      throw new ForbiddenException(
        this.IS_PRODUCTION
          ? 'You do not have permission to access this resource'
          : `Requires one of: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

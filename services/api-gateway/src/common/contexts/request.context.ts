import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isFullJwtPayload, RequestContext } from '@synapsedesk/common';

@Injectable()
export class RequestContextService {
  /**
   * Extract context from JWT payload + request.
   */
  static fromRequest(req: Request): RequestContext | null {
    const jwt = req.user;
    // Rejects a 2FA challenge payload as well as an absent one: a caller
    // mid-challenge has no permissions to build a RequestContext from.
    if (!isFullJwtPayload(jwt)) return null;

    return {
      sub: jwt.sub || '',
      organizationId: jwt.organizationId,
      isSuperAdmin: jwt.isSuperAdmin || false,
      departmentIds: jwt.departmentIds || [],
      permissionCodes: jwt.permissionCodes || [],
      isEmailVerified: jwt.isEmailVerified,
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
    };
  }

  // The metadata READER moved to `unpackCallerContext` in
  // libs/grpc-proto/src/metadata.ts. It never belonged here: the gateway packs
  // metadata and services unpack it, so a reader on this side had no caller and
  // sat unused beside a packer that wrote none of the keys it read.

  /**
   * Validate tenant-scoped access: request context organization must match resource organization.
   */
  static validateOrganizationScoping(
    context: RequestContext,
    resourceOrganizationId: string,
  ): boolean {
    if (context.isSuperAdmin) return true; // Supper admin can access any tenant
    return context.organizationId === resourceOrganizationId;
  }
}

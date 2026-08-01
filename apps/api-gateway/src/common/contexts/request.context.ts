import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  GRPC_CONTEXT_METADATA,
  isFullJwtPayload,
  PermissionCode,
  RequestContext,
} from '@synapsedesk/common';
import { Metadata } from '@grpc/grpc-js';

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

  /** Rebuilds the caller context the gateway packed into gRPC metadata. */
  static fromGrpcMetadata(metadata: Metadata): RequestContext {
    const one = (key: string) =>
      (metadata.get(key)[0] as string | undefined) ?? '';
    const json = <T>(key: string, fallback: T): T => {
      const raw = one(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    };

    return {
      sub: one(GRPC_CONTEXT_METADATA.userId),
      organizationId: one(GRPC_CONTEXT_METADATA.organizationId) || null,
      isSuperAdmin: one(GRPC_CONTEXT_METADATA.isSuperAdmin) === 'true',
      departmentIds: json<string[]>(GRPC_CONTEXT_METADATA.departmentIds, []),
      permissionCodes: json<PermissionCode[]>(
        GRPC_CONTEXT_METADATA.permissionCodes,
        [],
      ),
      isEmailVerified: one(GRPC_CONTEXT_METADATA.isEmailVerified) === 'true',
      ip: one(GRPC_CONTEXT_METADATA.ip),
      userAgent: one(GRPC_CONTEXT_METADATA.userAgent),
    };
  }

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

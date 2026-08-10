import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AuditLogResponse,
  CallerContext,
  emptyPage,
  fromProtoTimestamp,
  ListAuditActionsRequest,
  ListAuditActionsResponse,
  ListAuditLogsRequest,
  ListAuditLogsResponse,
  toPageMeta,
  toPrismaPage,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  AUDIT_LOG_SORTABLE_FIELDS,
  compareAlphabetically,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLog, Prisma } from '../../generated/prisma/client';

function toAuditLogResponse(log: AuditLog): AuditLogResponse {
  return {
    id: log.id,
    organizationId: log.organizationId ?? undefined,
    userId: log.userId ?? undefined,
    action: log.action,
    resourceType: log.resourceType ?? undefined,
    resourceId: log.resourceId ?? undefined,
    ipAddress: log.ipAddress ?? undefined,
    userAgent: log.userAgent ?? undefined,
    // JSON as a string. The shape differs per action, so a typed message could
    // only be a `map<string, string>` — which would flatten every nested value
    // in the before/after diff into uselessness.
    metadata: JSON.stringify(log.metadata ?? {}),
    createdAt: toProtoTimestamp(log.createdAt),
  };
}

/**
 * The audit trail, READ ONLY.
 *
 * There is no write method here and no `CreateAuditLog` message in the proto —
 * the table is populated exclusively by `AuditConsumer` off `audit.record`. The
 * absence is the design: a trail anybody can write to is a trail nobody can
 * rely on, and stating that in the contract means a future contributor has to
 * notice there is no write path before adding one.
 *
 * The scoping rule is the other load-bearing part. Platform rows
 * (`organization_id IS NULL`) and tenant rows are never mixed: a tenant admin
 * reading their own trail must not see platform acts, and a Super Admin reading
 * the platform trail must not have a customer's rows folded in. Two disjoint
 * views, chosen by an explicit flag rather than inferred from who is asking.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(
    request: ListAuditLogsRequest,
    context: CallerContext,
  ): Promise<ListAuditLogsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      AUDIT_LOG_SORTABLE_FIELDS,
    );

    const from = fromProtoTimestamp(request.from);
    const to = fromProtoTimestamp(request.to);

    const where: Prisma.AuditLogWhereInput = {
      ...this.scope(request.platformScope, context),
      ...(request.action ? { action: request.action } : {}),
      ...(request.userId ? { userId: request.userId } : {}),
      ...(request.resourceType ? { resourceType: request.resourceType } : {}),
      ...(request.resourceId ? { resourceId: request.resourceId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map(toAuditLogResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * Only the actions that ACTUALLY occurred, for filling a filter dropdown.
   *
   * Not the `AuditAction` enum. A customer who can never trigger a `PLATFORM_*`
   * action should not be offered it as a filter — every such option is a
   * guaranteed-empty result, and a dropdown mostly made of those trains people
   * to distrust the filter.
   */
  async listAuditActions(
    request: ListAuditActionsRequest,
    context: CallerContext,
  ): Promise<ListAuditActionsResponse> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.scope(request.platformScope, context),
      select: { action: true },
      distinct: ['action'],
    });

    return {
      actions: rows
        .map((row) => row.action)
        .sort((a, b) => compareAlphabetically(a, b)),
    };
  }

  /**
   * The two disjoint views.
   *
   * `organizationId: null` is an EXPLICIT null, not an omitted key: omitting it
   * would match every row in every tenant, which is the one outcome this method
   * exists to prevent.
   */
  private scope(
    platformScope: boolean,
    context: CallerContext,
  ): Prisma.AuditLogWhereInput {
    if (!platformScope) {
      // `requireTenant` throws for a Super Admin, whose context carries a null
      // organization — which is correct: there is no "their own tenant" trail
      // for them to read, and they must ask for the platform view explicitly.
      return { organizationId: requireTenant(context) };
    }

    if (!context.isSuperAdmin) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'The platform audit trail is restricted to Super Admins',
      });
    }

    return { organizationId: null };
  }
}

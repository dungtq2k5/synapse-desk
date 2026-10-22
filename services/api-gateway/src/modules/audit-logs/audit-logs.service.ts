import { Injectable, Logger } from '@nestjs/common';
import {
  AuditResourceType,
  ExportKind,
  RequestContext,
} from '@synapsedesk/contracts';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { PlatformGrpcClient } from '../platform/platform-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import {
  toAuditActions,
  toAuditLogPageDto,
  toListAuditLogsRequest,
} from './audit-log.mapper';
import {
  AuditActionsResponseDto,
  AuditLogResponseDto,
  PlatformAuditLogResponseDto,
} from './dto/rest/audit-log-response.dto';
import {
  CreateAuditLogExportDto,
  ListAuditLogsQueryDto,
} from './dto/rest/audit-log.dto';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExportResponseDto } from '../analytics/dto/rest/analytics-response.dto';

/** The gateway's audit-trail surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    private readonly auditLogsGrpcClient: AuditLogsGrpcClient,
    private readonly platform: PlatformGrpcClient,
    // The export lifecycle is shared, so the RPC is too — this module owns the
    // ROUTE, not a second copy of the machinery.
    private readonly analytics: AnalyticsService,
  ) {}

  /** @param platformScope Reads the platform's own rows instead of a tenant's. */
  async list(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
    platformScope = false,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    return toAuditLogPageDto(
      await this.auditLogsGrpcClient.list(
        toListAuditLogsRequest(query, platformScope),
        context,
      ),
    );
  }

  /**
   * The platform's own trail, with names for its people, organizations and
   * plans, read in one call to auth. A failed lookup leaves the names null:
   * the trail still reads, by id.
   */
  async listPlatform(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformAuditLogResponseDto>> {
    const page = await this.list(query, context, true);
    const ids = (type: AuditResourceType) => [
      ...new Set(
        page.items
          .filter((entry) => entry.resourceType === type && entry.resourceId)
          .map((entry) => entry.resourceId!),
      ),
    ];
    const names = await this.platform
      .resolveAuditNames(
        {
          userIds: [
            ...new Set(
              page.items.flatMap((entry) =>
                entry.userId ? [entry.userId] : [],
              ),
            ),
          ],
          organizationIds: ids(AuditResourceType.ORGANIZATION),
          planIds: ids(AuditResourceType.SUBSCRIPTION_PLAN),
        },
        context,
      )
      .catch((error: unknown) => {
        this.logger.warn(`Audit names unavailable: ${formatErrorMsg(error)}`);
        return null;
      });
    const resourceName = (entry: AuditLogResponseDto) => {
      if (!names || !entry.resourceId) return null;
      if (entry.resourceType === AuditResourceType.ORGANIZATION) {
        return names.organizations[entry.resourceId] ?? null;
      }
      if (entry.resourceType === AuditResourceType.SUBSCRIPTION_PLAN) {
        return names.plans[entry.resourceId] ?? null;
      }
      return null;
    };
    return {
      ...page,
      items: page.items.map((entry) => ({
        ...entry,
        actorName: (entry.userId && names?.users[entry.userId]) || null,
        resourceName: resourceName(entry),
      })),
    };
  }

  /** The actions that actually occurred, for the filter dropdown. */
  async listActions(
    context: RequestContext,
    platformScope = false,
  ): Promise<AuditActionsResponseDto> {
    return {
      actions: toAuditActions(
        await this.auditLogsGrpcClient.listActions(context, platformScope),
      ),
    };
  }

  /**
   * Requests an export through the SAME lifecycle the analytics export uses.
   *
   * One table, one queue, one processor, one poll — the three exports differ in
   * what they select, not in how they live. `AnalyticsService` owns the RPC
   * because the RPC is on `AnalyticsService`; this module owns the ROUTE
   * because `/audit-logs/*` is its prefix.
   */
  async createExport(
    dto: CreateAuditLogExportDto,
    context: RequestContext,
  ): Promise<ExportResponseDto> {
    return this.analytics.createExport(
      {
        kind: ExportKind.AUDIT_LOG,
        from: dto.from,
        to: dto.to,
        filters: dto.filters,
      },
      context,
    );
  }

  async getExport(
    id: string,
    context: RequestContext,
  ): Promise<ExportResponseDto> {
    return this.analytics.getExport(id, context);
  }
}

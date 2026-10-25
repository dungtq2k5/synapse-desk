import { Injectable, Logger } from '@nestjs/common';
import {
  AuditResourceType,
  ExportKind,
  RequestContext,
} from '@synapsedesk/contracts';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { PlatformGrpcClient } from '../platform/platform-grpc.client';
import { OrganizationsGrpcClient } from '../organizations/organizations-grpc.client';
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
    private readonly organizations: OrganizationsGrpcClient,
    // The export lifecycle is shared, so the RPC is too — this module owns the
    // ROUTE, not a second copy of the machinery.
    private readonly analytics: AnalyticsService,
  ) {}

  /** The tenant's log, each entry named through the tenant-scoped read. */
  async list(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    const page = await this.page(query, context, false);
    const names = await this.organizations
      .resolveAuditNames(
        {
          userIds: actorIds(page.items),
          departmentIds: resourceIds(page.items, AuditResourceType.DEPARTMENT),
          roleIds: resourceIds(page.items, AuditResourceType.ROLE),
          invitationIds: resourceIds(page.items, AuditResourceType.INVITATION),
          organizationIds: resourceIds(
            page.items,
            AuditResourceType.ORGANIZATION,
          ),
          planIds: resourceIds(page.items, AuditResourceType.SUBSCRIPTION_PLAN),
        },
        context,
      )
      .catch((error: unknown) => this.unnamed(error));
    return named(
      page,
      names && {
        users: names.users,
        [AuditResourceType.DEPARTMENT]: names.departments,
        [AuditResourceType.ROLE]: names.roles,
        [AuditResourceType.INVITATION]: names.invitations,
        [AuditResourceType.ORGANIZATION]: names.organizations,
        [AuditResourceType.SUBSCRIPTION_PLAN]: names.plans,
      },
    );
  }

  /** The platform's log, named through the platform's read. */
  async listPlatform(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformAuditLogResponseDto>> {
    const page = await this.page(query, context, true);
    const names = await this.platform
      .resolveAuditNames(
        {
          userIds: actorIds(page.items),
          organizationIds: resourceIds(
            page.items,
            AuditResourceType.ORGANIZATION,
          ),
          planIds: resourceIds(page.items, AuditResourceType.SUBSCRIPTION_PLAN),
        },
        context,
      )
      .catch((error: unknown) => this.unnamed(error));
    return named(
      page,
      names && {
        users: names.users,
        [AuditResourceType.ORGANIZATION]: names.organizations,
        [AuditResourceType.SUBSCRIPTION_PLAN]: names.plans,
      },
    );
  }

  /** @param platformScope Reads the platform's own rows instead of a tenant's. */
  private async page(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
    platformScope: boolean,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    return toAuditLogPageDto(
      await this.auditLogsGrpcClient.list(
        toListAuditLogsRequest(query, platformScope),
        context,
      ),
    );
  }

  /** Names are a courtesy: the page still answers, with ids, without them. */
  private unnamed(error: unknown): null {
    this.logger.warn(`Audit names unavailable: ${formatErrorMsg(error)}`);
    return null;
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

type Names = Partial<
  Record<'users' | AuditResourceType, Record<string, string>>
>;

const actorIds = (items: AuditLogResponseDto[]): string[] => [
  ...new Set(items.flatMap((entry) => (entry.userId ? [entry.userId] : []))),
];

const resourceIds = (
  items: AuditLogResponseDto[],
  type: AuditResourceType,
): string[] => [
  ...new Set(
    items.flatMap((entry) =>
      entry.resourceType === type && entry.resourceId ? [entry.resourceId] : [],
    ),
  ),
];

/** Each entry with `actorName` and `resourceName` from `names`, or null. */
function named(
  page: PaginationResponseDto<AuditLogResponseDto>,
  names: Names | null,
): PaginationResponseDto<AuditLogResponseDto> {
  return {
    ...page,
    items: page.items.map((entry) => ({
      ...entry,
      actorName: (entry.userId && names?.users?.[entry.userId]) || null,
      resourceName:
        (entry.resourceType &&
          entry.resourceId &&
          names?.[entry.resourceType]?.[entry.resourceId]) ||
        null,
    })),
  };
}

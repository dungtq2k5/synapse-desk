import { Injectable } from '@nestjs/common';
import { ExportKind, RequestContext } from '@synapsedesk/common';
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
  constructor(
    private readonly auditLogsGrpcClient: AuditLogsGrpcClient,
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

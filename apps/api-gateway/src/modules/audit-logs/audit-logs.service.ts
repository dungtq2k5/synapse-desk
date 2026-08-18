import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import {
  toAuditActionList,
  toAuditLogPageDto,
  toListAuditLogsRequest,
} from './audit-log.mapper';
import {
  AuditActionsResponseDto,
  AuditLogResponseDto,
} from './dto/rest/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/rest/audit-log.dto';

/** The gateway's audit-trail surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogsGrpcClient: AuditLogsGrpcClient) {}

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
      actions: toAuditActionList(
        await this.auditLogsGrpcClient.listActions(context, platformScope),
      ),
    };
  }
}

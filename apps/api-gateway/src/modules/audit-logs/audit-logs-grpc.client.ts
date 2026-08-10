import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUDIT_SERVICE_NAME,
  AuditLogResponse,
  AuditServiceClient,
  requireProtoTimestamp,
  TICKET_GRPC_CLIENT,
  toPageRequest,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { AuditLogResponseDto } from './dto/rest/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/rest/audit-log.dto';

@Injectable()
export class AuditLogsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ticket-service';

  private readonly logger = new Logger(AuditLogsGrpcClient.name);

  private auditGrpcService!: AuditServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.auditGrpcService =
      this.client.getService<AuditServiceClient>(AUDIT_SERVICE_NAME);
  }

  async list(
    query: ListAuditLogsQueryDto,
    context: RequestContext,
    platformScope = false,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.auditGrpcService.listAuditLogs(
          {
            page: toPageRequest(query),
            // '' rather than undefined: proto3 scalars have no null, and the
            // service reads the empty string as "no filter".
            action: query.action ?? '',
            userId: query.userId ?? '',
            resourceType: query.resourceType ?? '',
            resourceId: query.resourceId ?? '',
            from: toProtoTimestamp(query.from ?? null),
            to: toProtoTimestamp(query.to ?? null),
            platformScope,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map((item) => this.toDto(item)),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async listActions(
    context: RequestContext,
    platformScope = false,
  ): Promise<string[]> {
    const response = await this.call(
      (metadata) =>
        this.auditGrpcService.listAuditActions({ platformScope }, metadata),
      context,
    );

    return response.actions;
  }

  /**
   * Parses `metadata` back into an object.
   *
   * A malformed value yields `{}` and a log line rather than a 500. The trail
   * is what somebody reaches for when something has already gone wrong, and
   * failing the whole page because one row's diff cannot be parsed would take
   * the tool away exactly when it is needed. The rest of that row is still
   * perfectly readable.
   */
  private toDto(log: AuditLogResponse): AuditLogResponseDto {
    return {
      id: log.id,
      organizationId: log.organizationId ?? null,
      userId: log.userId ?? null,
      action: log.action,
      resourceType: log.resourceType ?? null,
      resourceId: log.resourceId ?? null,
      ipAddress: log.ipAddress ?? null,
      userAgent: log.userAgent ?? null,
      metadata: this.parseMetadata(log.metadata, log.id),
      createdAt: requireProtoTimestamp(log.createdAt, 'createdAt'),
    };
  }

  private parseMetadata(raw: string, logId: string): Record<string, unknown> {
    if (!raw) return {};

    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      this.logger.warn(`Audit log ${logId} has unparseable metadata`);
      return {};
    }
  }
}

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUDIT_SERVICE_NAME,
  AuditServiceClient,
  TICKET_GRPC_CLIENT,
  toPageRequest,
  toProtoTimestamp,
  fromProtoAuditAction,
  toProtoAuditAction,
  toProtoAuditResourceType,
} from '@synapsedesk/grpc-proto';
import { AuditAction, RequestContext } from '@synapsedesk/common';
import { toAuditLogResponseDto } from './audit-log.mapper';
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
            // UNSPECIFIED rather than '' for the two enumerated filters —
            // proto3's zero value already carries "no filter", so the empty
            // string that used to stand in for it is gone. The `@IsIn` on the
            // query DTO means an unknown value never reaches here as a 200.
            action: toProtoAuditAction(query.action),
            userId: query.userId ?? '',
            resourceType: toProtoAuditResourceType(query.resourceType),
            // Still a plain string: a resource ID is a uuid, not a vocabulary.
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
      items: response.items.map((item) => toAuditLogResponseDto(item)),
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

    // Filtered rather than defaulted: a value this build cannot name would
    // otherwise become the literal 'UNSPECIFIED' in a filter dropdown, which is
    // an option that selects nothing.
    return response.actions
      .map((action) => fromProtoAuditAction(action))
      .filter((action): action is AuditAction => action !== null);
  }
}

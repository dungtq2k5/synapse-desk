import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUDIT_SERVICE_NAME,
  AuditServiceClient,
  TICKET_GRPC_CLIENT,
  ListAuditActionsResponse,
  ListAuditLogsRequest,
  ListAuditLogsResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class AuditLogsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ticket-service';

  private auditGrpcService!: AuditServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.auditGrpcService =
      this.client.getService<AuditServiceClient>(AUDIT_SERVICE_NAME);
  }

  list(
    request: ListAuditLogsRequest,
    context: RequestContext,
  ): Promise<ListAuditLogsResponse> {
    return this.call(
      (metadata) => this.auditGrpcService.listAuditLogs(request, metadata),
      context,
    );
  }

  listActions(
    context: RequestContext,
    platformScope = false,
  ): Promise<ListAuditActionsResponse> {
    return this.call(
      (metadata) =>
        this.auditGrpcService.listAuditActions({ platformScope }, metadata),
      context,
    );
  }
}

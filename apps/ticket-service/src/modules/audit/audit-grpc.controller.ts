import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AuditServiceController,
  AuditServiceControllerMethods,
  ListAuditActionsRequest,
  ListAuditActionsResponse,
  ListAuditLogsRequest,
  ListAuditLogsResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { AuditReadService } from './audit-read.service';

/**
 * Two methods, both reads. There is nothing else in the proto to implement.
 */
@Controller()
@AuditServiceControllerMethods()
export class AuditGrpcController implements AuditServiceController {
  constructor(private readonly auditRead: AuditReadService) {}

  listAuditLogs(
    request: ListAuditLogsRequest,
    metadata?: Metadata,
  ): Promise<ListAuditLogsResponse> {
    return this.auditRead.listAuditLogs(request, unpackCallerContext(metadata));
  }

  listAuditActions(
    request: ListAuditActionsRequest,
    metadata?: Metadata,
  ): Promise<ListAuditActionsResponse> {
    return this.auditRead.listAuditActions(
      request,
      unpackCallerContext(metadata),
    );
  }
}

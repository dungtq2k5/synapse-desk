import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  CancelIngestionJobResponse,
  DOCUMENT_SERVICE_NAME,
  DocumentServiceClient,
  INGESTION_GRPC_CLIENT,
  IngestionJobResponse,
  ListIngestionJobsRequest,
  ListIngestionJobsResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/** The ingestion-service RPCs behind the pipeline worklist. */
@Injectable()
export class IngestionJobsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ingestion-service';

  private documentGrpcService!: DocumentServiceClient;

  constructor(
    @Inject(INGESTION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {
    super();
  }

  onModuleInit() {
    // The same peer connection `DocumentsGrpcClient` uses — these RPCs are
    // declared on `DocumentService`.
    this.documentGrpcService = this.client.getService<DocumentServiceClient>(
      DOCUMENT_SERVICE_NAME,
    );
  }

  list(
    request: ListIngestionJobsRequest,
    context: RequestContext,
  ): Promise<ListIngestionJobsResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listIngestionJobs(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<IngestionJobResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.getIngestionJob({ id }, metadata),
      context,
    );
  }

  retry(id: string, context: RequestContext): Promise<IngestionJobResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.retryIngestionJob({ id }, metadata),
      context,
    );
  }

  cancel(
    id: string,
    context: RequestContext,
  ): Promise<CancelIngestionJobResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.cancelIngestionJob({ id }, metadata),
      context,
    );
  }

  listForDocument(
    documentId: string,
    context: RequestContext,
  ): Promise<ListIngestionJobsResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentIngestionJobs(
          { id: documentId },
          metadata,
        ),
      context,
    );
  }
}

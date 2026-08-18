import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  DOCUMENT_SERVICE_NAME,
  DocumentServiceClient,
  INGESTION_GRPC_CLIENT,
  ConfirmDocumentRequest,
  DocumentChunkResponse,
  DocumentResponse,
  DownloadDocumentResponse,
  ListDocumentChunksResponse,
  ListDocumentDepartmentsResponse,
  ListDocumentFlagsRequest,
  ListDocumentFlagsResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  PresignDocumentRequest,
  PresignDocumentResponse,
  SetDocumentDepartmentsRequest,
  StorageUsageResponse,
  UpdateDocumentRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class DocumentsGrpcClient
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
    this.documentGrpcService = this.client.getService<DocumentServiceClient>(
      DOCUMENT_SERVICE_NAME,
    );
  }

  presign(
    request: PresignDocumentRequest,
    context: RequestContext,
  ): Promise<PresignDocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.presignDocument(request, metadata),
      context,
    );
  }

  confirm(
    request: ConfirmDocumentRequest,
    context: RequestContext,
  ): Promise<DocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.confirmDocument(request, metadata),
      context,
    );
  }

  list(
    request: ListDocumentsRequest,
    context: RequestContext,
  ): Promise<ListDocumentsResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.listDocuments(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<DocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.getDocument({ id }, metadata),
      context,
    );
  }

  update(
    request: UpdateDocumentRequest,
    context: RequestContext,
  ): Promise<DocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.updateDocument(request, metadata),
      context,
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.documentGrpcService.deleteDocument({ id }, metadata),
      context,
    );
  }

  restore(id: string, context: RequestContext): Promise<DocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.restoreDocument({ id }, metadata),
      context,
    );
  }

  download(
    id: string,
    context: RequestContext,
  ): Promise<DownloadDocumentResponse> {
    return this.call(
      (metadata) => this.documentGrpcService.downloadDocument({ id }, metadata),
      context,
    );
  }

  listDepartments(
    id: string,
    context: RequestContext,
  ): Promise<ListDocumentDepartmentsResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentDepartments({ id }, metadata),
      context,
    );
  }

  setDepartments(
    request: SetDocumentDepartmentsRequest,
    context: RequestContext,
  ): Promise<DocumentResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.setDocumentDepartments(request, metadata),
      context,
    );
  }

  listChunks(
    documentId: string,
    page: ListDocumentsRequest['page'],
    context: RequestContext,
  ): Promise<ListDocumentChunksResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentChunks(
          { documentId, page },
          metadata,
        ),
      context,
    );
  }

  getChunk(
    documentId: string,
    chunkId: string,
    context: RequestContext,
  ): Promise<DocumentChunkResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.getDocumentChunk(
          { documentId, chunkId },
          metadata,
        ),
      context,
    );
  }

  listFlags(
    request: ListDocumentFlagsRequest,
    context: RequestContext,
  ): Promise<ListDocumentFlagsResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentFlags(request, metadata),
      context,
    );
  }

  /** The id is ignored — storage usage is a WORKSPACE total. */
  storageUsage(context: RequestContext): Promise<StorageUsageResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.getStorageUsage({ id: '' }, metadata),
      context,
    );
  }
}

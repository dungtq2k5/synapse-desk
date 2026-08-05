import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  DOCUMENT_SERVICE_NAME,
  DocumentServiceClient,
  INGESTION_GRPC_CLIENT,
  requireTimestamp,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import {
  ConfirmDocumentDto,
  ListDocumentsQueryDto,
  PresignDocumentDto,
  SetDocumentDepartmentsDto,
  UpdateDocumentDto,
} from './dto/rest/document.dto';
import {
  DocumentChunkResponseDto,
  DocumentResponseDto,
  DownloadDocumentResponseDto,
  PresignDocumentResponseDto,
  StorageUsageResponseDto,
} from './dto/rest/document-response.dto';
import { toChunkDto, toDocumentDto } from './document.mapper';

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

  async presign(
    dto: PresignDocumentDto,
    context: RequestContext,
  ): Promise<PresignDocumentResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.documentGrpcService.presignDocument(
          {
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
            fileName: dto.fileName,
          },
          metadata,
        ),
      context,
    );

    return {
      uploadUrl: response.uploadUrl,
      objectPath: response.objectPath,
      expiresAt: requireTimestamp(response.expiresAt, 'expiresAt'),
    };
  }

  async confirm(
    dto: ConfirmDocumentDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentDto(
      await this.call(
        (metadata) =>
          this.documentGrpcService.confirmDocument(
            {
              objectPath: dto.objectPath,
              title: dto.title,
              // `?? true`: proto3 booleans have no null, and an absent flag
              // means the RDM default rather than "unspecified".
              isOrganizationWide: dto.isOrganizationWide ?? true,
              departmentIds: dto.departmentIds ?? [],
              fileName: dto.fileName ?? '',
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async list(
    query: ListDocumentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<DocumentResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.documentGrpcService.listDocuments(
          {
            page: toPageRequest(query),
            // '' rather than undefined: proto3 scalars have no null, and the
            // service reads the empty string as "no filter".
            status: query.status ?? '',
            departmentId: query.departmentId ?? '',
            fileType: query.fileType ?? '',
            includeDeleted: query.includeDeleted ?? false,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toDocumentDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async get(id: string, context: RequestContext): Promise<DocumentResponseDto> {
    return toDocumentDto(
      await this.call(
        (metadata) => this.documentGrpcService.getDocument({ id }, metadata),
        context,
      ),
    );
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentDto(
      await this.call(
        (metadata) =>
          this.documentGrpcService.updateDocument(
            {
              id,
              title: dto.title,
              isOrganizationWide: dto.isOrganizationWide,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.documentGrpcService.deleteDocument({ id }, metadata),
      context,
    );
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentDto(
      await this.call(
        (metadata) =>
          this.documentGrpcService.restoreDocument({ id }, metadata),
        context,
      ),
    );
  }

  async download(
    id: string,
    context: RequestContext,
  ): Promise<DownloadDocumentResponseDto> {
    const response = await this.call(
      (metadata) => this.documentGrpcService.downloadDocument({ id }, metadata),
      context,
    );

    return {
      downloadUrl: response.downloadUrl,
      expiresAt: requireTimestamp(response.expiresAt, 'expiresAt'),
    };
  }

  async listDepartments(
    id: string,
    context: RequestContext,
  ): Promise<string[]> {
    const response = await this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentDepartments({ id }, metadata),
      context,
    );

    return response.departmentIds;
  }

  async setDepartments(
    id: string,
    dto: SetDocumentDepartmentsDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentDto(
      await this.call(
        (metadata) =>
          this.documentGrpcService.setDocumentDepartments(
            { id, departmentIds: dto.departmentIds },
            metadata,
          ),
        context,
      ),
    );
  }

  async listChunks(
    documentId: string,
    query: ListDocumentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<DocumentChunkResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.documentGrpcService.listDocumentChunks(
          { documentId, page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toChunkDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async getChunk(
    documentId: string,
    chunkId: string,
    context: RequestContext,
  ): Promise<DocumentChunkResponseDto> {
    return toChunkDto(
      await this.call(
        (metadata) =>
          this.documentGrpcService.getDocumentChunk(
            { documentId, chunkId },
            metadata,
          ),
        context,
      ),
    );
  }

  async storageUsage(
    context: RequestContext,
  ): Promise<StorageUsageResponseDto> {
    const response = await this.call(
      // The id is ignored — storage usage is a WORKSPACE total. The proto
      // reuses `DocumentIdRequest` rather than adding an empty message.
      (metadata) =>
        this.documentGrpcService.getStorageUsage({ id: '' }, metadata),
      context,
    );

    return {
      usedBytes: response.usedBytes,
      limitBytes: response.limitBytes,
      documentCount: response.documentCount,
    };
  }
}

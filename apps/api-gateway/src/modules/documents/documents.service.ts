import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { toPageRequest } from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { DocumentsGrpcClient } from './documents-grpc.client';
import {
  toConfirmDocumentRequest,
  toDocumentChunkPageDto,
  toDocumentChunkResponseDto,
  toDocumentFlagPageDto,
  toDocumentPageDto,
  toDocumentResponseDto,
  toDownloadDocumentResponseDto,
  toListDocumentFlagsRequest,
  toListDocumentsRequest,
  toPresignDocumentResponseDto,
  toStorageUsageResponseDto,
} from './document.mapper';
import {
  ConfirmDocumentDto,
  ListDocumentFlagsQueryDto,
  ListDocumentsQueryDto,
  PresignDocumentDto,
  SetDocumentDepartmentsDto,
  UpdateDocumentDto,
} from './dto/rest/document.dto';
import {
  DocumentChunkResponseDto,
  DocumentDepartmentsResponseDto,
  DocumentFlagResponseDto,
  DocumentResponseDto,
  DownloadDocumentResponseDto,
  PresignDocumentResponseDto,
  StorageUsageResponseDto,
} from './dto/rest/document-response.dto';

/** The gateway's document surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class DocumentsService {
  constructor(private readonly documentsGrpcClient: DocumentsGrpcClient) {}

  async presign(
    dto: PresignDocumentDto,
    context: RequestContext,
  ): Promise<PresignDocumentResponseDto> {
    return toPresignDocumentResponseDto(
      await this.documentsGrpcClient.presign(
        {
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
          fileName: dto.fileName,
        },
        context,
      ),
    );
  }

  async confirm(
    dto: ConfirmDocumentDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.confirm(
        toConfirmDocumentRequest(dto),
        context,
      ),
    );
  }

  async list(
    query: ListDocumentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DocumentResponseDto>> {
    return toDocumentPageDto(
      await this.documentsGrpcClient.list(
        toListDocumentsRequest(query),
        context,
      ),
    );
  }

  async get(id: string, context: RequestContext): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.get(id, context),
    );
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.update(
        { id, title: dto.title, isOrganizationWide: dto.isOrganizationWide },
        context,
      ),
    );
  }

  remove(id: string, context: RequestContext): Promise<void> {
    return this.documentsGrpcClient.remove(id, context);
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.restore(id, context),
    );
  }

  async download(
    id: string,
    context: RequestContext,
  ): Promise<DownloadDocumentResponseDto> {
    return toDownloadDocumentResponseDto(
      await this.documentsGrpcClient.download(id, context),
    );
  }

  async listDepartments(
    id: string,
    context: RequestContext,
  ): Promise<DocumentDepartmentsResponseDto> {
    const { departmentIds } = await this.documentsGrpcClient.listDepartments(
      id,
      context,
    );

    return { departmentIds };
  }

  async setDepartments(
    id: string,
    dto: SetDocumentDepartmentsDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.setDepartments(
        { id, departmentIds: dto.departmentIds },
        context,
      ),
    );
  }

  async listChunks(
    documentId: string,
    query: ListDocumentsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DocumentChunkResponseDto>> {
    return toDocumentChunkPageDto(
      await this.documentsGrpcClient.listChunks(
        documentId,
        toPageRequest(query),
        context,
      ),
    );
  }

  async getChunk(
    documentId: string,
    chunkId: string,
    context: RequestContext,
  ): Promise<DocumentChunkResponseDto> {
    return toDocumentChunkResponseDto(
      await this.documentsGrpcClient.getChunk(documentId, chunkId, context),
    );
  }

  async listFlags(
    query: ListDocumentFlagsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<DocumentFlagResponseDto>> {
    return toDocumentFlagPageDto(
      await this.documentsGrpcClient.listFlags(
        toListDocumentFlagsRequest(query),
        context,
      ),
    );
  }

  async storageUsage(
    context: RequestContext,
  ): Promise<StorageUsageResponseDto> {
    return toStorageUsageResponseDto(
      await this.documentsGrpcClient.storageUsage(context),
    );
  }
}

import { Injectable } from '@nestjs/common';
import { DocumentFlagResolution, RequestContext } from '@synapsedesk/common';
import {
  toPageRequest,
  toProtoDocumentFlagResolution,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { DocumentsGrpcClient } from './documents-grpc.client';
import {
  toConfirmDocumentRequest,
  toDocumentChunkPageDto,
  toDocumentChunkResponseDto,
  toDocumentFlagPageDto,
  toDocumentFlagResponseDto,
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
  ResolveDocumentFlagDto,
  ReplaceDocumentDto,
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
import { IngestionJobResponseDto } from '../ingestion-jobs/dto/rest/ingestion-job-response.dto';
import { toIngestionJobResponseDto } from '../ingestion-jobs/ingestion-job.mapper';

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

  async reindex(
    id: string,
    context: RequestContext,
  ): Promise<IngestionJobResponseDto> {
    return toIngestionJobResponseDto(
      await this.documentsGrpcClient.reindex(id, context),
    );
  }

  async replace(
    id: string,
    dto: ReplaceDocumentDto,
    context: RequestContext,
  ): Promise<DocumentResponseDto> {
    return toDocumentResponseDto(
      await this.documentsGrpcClient.replace(
        { id, objectPath: dto.objectPath, ocrLanguages: dto.ocrLanguages },
        context,
      ),
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

  async getFlag(
    id: string,
    context: RequestContext,
  ): Promise<DocumentFlagResponseDto> {
    return toDocumentFlagResponseDto(
      await this.documentsGrpcClient.getFlag(id, context),
    );
  }

  /**
   * Resolves a flag as `resolution`.
   *
   * The resolution comes from the ROUTE, never the body: three endpoints, one
   * RPC, and no way for a client to send a value the route did not mean.
   */
  async resolveFlag(
    flagId: string,
    resolution: DocumentFlagResolution,
    dto: ResolveDocumentFlagDto,
    context: RequestContext,
  ): Promise<DocumentFlagResponseDto> {
    return toDocumentFlagResponseDto(
      await this.documentsGrpcClient.resolveFlag(
        {
          id: flagId,
          resolution: toProtoDocumentFlagResolution(resolution),
          comment: dto.comment,
        },
        context,
      ),
    );
  }

  /**
   * Removes a flag row.
   *
   * The wire's `deleted` flag is discarded: the only false it could carry is a
   * failure, and a failure arrives as an exception.
   */
  async deleteFlag(id: string, context: RequestContext): Promise<void> {
    await this.documentsGrpcClient.deleteFlag(id, context);
  }

  async storageUsage(
    context: RequestContext,
  ): Promise<StorageUsageResponseDto> {
    return toStorageUsageResponseDto(
      await this.documentsGrpcClient.storageUsage(context),
    );
  }
}

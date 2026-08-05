import {
  DocumentChunkResponse,
  DocumentResponse,
  fromTimestamp,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  DocumentChunkResponseDto,
  DocumentResponseDto,
} from './dto/rest/document-response.dto';
import { DocumentStatus } from '@synapsedesk/common';

export function toDocumentDto(document: DocumentResponse): DocumentResponseDto {
  return {
    id: document.id,
    organizationId: document.organizationId,
    createdById: document.createdById,
    title: document.title,
    fileUrl: document.fileUrl,
    fileType: document.fileType,
    fileSizeBytes: document.fileSizeBytes,
    isOrganizationWide: document.isOrganizationWide,
    // A free string on the wire, narrowed here. An unrecognised value becomes
    // null rather than being passed through: a client switching on the status
    // should see "unknown" explicitly, not a string its union does not have.
    status: (document.status as DocumentStatus) || null,
    departmentIds: document.departmentIds,
    chunkCount: document.chunkCount,
    createdAt: requireTimestamp(document.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(document.updatedAt, 'updatedAt'),
    deletedAt: fromTimestamp(document.deletedAt) ?? null,
    deletedById: document.deletedById ?? null,
  };
}

export function toChunkDto(
  chunk: DocumentChunkResponse,
): DocumentChunkResponseDto {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    contentText: chunk.contentText,
    // `?? null`, never `|| null`: page 0 does not exist in a PDF, but the same
    // habit applied to `tokenCount` would erase a legitimately empty chunk.
    pageNumber: chunk.pageNumber ?? null,
    tokenCount: chunk.tokenCount,
    vectorPointId: chunk.vectorPointId ?? null,
    createdAt: requireTimestamp(chunk.createdAt, 'createdAt'),
  };
}

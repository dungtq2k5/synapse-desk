import {
  DocumentChunkResponse,
  DocumentResponse,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import { Document, DocumentChunk } from '../../generated/prisma/client';

/**
 * Prisma row -> wire.
 *
 * `departmentIds` and `chunkCount` are passed in rather than read off the row:
 * both come from relations the caller has already loaded (or deliberately has
 * not), and re-querying them here would turn one list page into two queries per
 * row.
 */
export function toDocumentResponse(
  document: Document,
  departmentIds: string[],
  chunkCount: number,
): DocumentResponse {
  return {
    id: document.id,
    organizationId: document.organizationId,
    createdById: document.createdById,
    title: document.title,
    // An object PATH, not a URL. `GET /documents/:id/download` resolves it to a
    // fresh signed URL per request, so revoking access takes effect on the next
    // read rather than whenever a stored URL happened to expire.
    fileUrl: document.fileUrl,
    fileType: document.fileType,
    // BigInt -> number. `longs: Number` makes int64 a plain JS number on both
    // ends, exact to 2^53 — nine petabytes is not a limit worth engineering
    // around for a 25 MB-per-file corpus.
    fileSizeBytes: Number(document.fileSizeBytes),
    isOrganizationWide: document.isOrganizationWide,
    status: document.status,
    departmentIds,
    chunkCount,
    createdAt: toTimestamp(document.createdAt),
    updatedAt: toTimestamp(document.updatedAt),
    deletedAt: toTimestamp(document.deletedAt),
    deletedById: document.deletedById ?? undefined,
  };
}

export function toDocumentChunkResponse(
  chunk: DocumentChunk,
): DocumentChunkResponse {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    contentText: chunk.contentText,
    pageNumber: chunk.pageNumber ?? undefined,
    tokenCount: chunk.tokenCount,
    // Absent until the Qdrant upsert has written it back. That absence is
    // meaningful — it means this chunk is not retrievable yet — so it is
    // reported rather than defaulted.
    vectorPointId: chunk.vectorPointId ?? undefined,
    createdAt: toTimestamp(chunk.createdAt),
  };
}

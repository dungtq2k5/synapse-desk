import {
  DocumentChunkResponse,
  DocumentFlagResponse,
  DocumentResponse,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  Document,
  DocumentChunk,
  DocumentFlag,
  Prisma,
} from '../../generated/prisma/client';

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
    createdAt: toProtoTimestamp(document.createdAt),
    updatedAt: toProtoTimestamp(document.updatedAt),
    deletedAt: toProtoTimestamp(document.deletedAt),
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
    createdAt: toProtoTimestamp(chunk.createdAt),
  };
}

/**
 * A flag, WITH its document's title.
 *
 * The title is joined in rather than left to the client: a flag list is read as
 * a worklist ("which documents need attention"), and a page of uuids is one the
 * reviewer has to resolve by hand before it means anything.
 */
export function toDocumentFlagResponse(
  flag: DocumentFlag & { document: { title: string } },
): DocumentFlagResponse {
  return {
    id: flag.id,
    documentId: flag.documentId,
    documentTitle: flag.document.title,
    flagType: flag.flagType,
    severity: flag.severity,
    detail: flag.detail,
    confidenceScore: flag.confidenceScore ?? undefined,
    detectedAt: toProtoTimestamp(flag.detectedAt),
  };
}

/**
 * The relations every document read needs, declared ONCE.
 *
 * `departmentLinks` is the department half of the visibility answer and
 * `_count.chunks` is what the UI shows for ingestion progress. Repeating the
 * shape at each call site is how one query eventually forgets a relation and
 * returns a document with no departments — which reads as "org-wide" to
 * anything checking the array.
 */
export const DOCUMENT_INCLUDE = {
  departmentLinks: { select: { departmentId: true } },
  _count: { select: { chunks: true } },
} satisfies Prisma.DocumentInclude;

export type DocumentWithScope = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

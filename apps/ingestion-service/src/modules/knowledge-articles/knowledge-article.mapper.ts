import {
  KnowledgeArticleBlockResponse,
  KnowledgeArticleResponse,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { Document, DocumentChunk } from '../../generated/prisma/client';

/** A document row, as the help centre sees it. */
export function toKnowledgeArticleResponse(
  document: Document & { _count: { chunks: number } },
): KnowledgeArticleResponse {
  // Deliberately four fields. `fileUrl`, `fileHash`, `fileSizeBytes`,
  // `createdById` and the department links exist on the row and stop here —
  // the narrow type is the boundary, not a mapper that remembers to omit them.
  return {
    id: document.id,
    title: document.title,
    updatedAt: toProtoTimestamp(document.updatedAt),
    chunkCount: document._count.chunks,
  };
}

/** One block of extracted text. */
export function toKnowledgeArticleBlockResponse(
  chunk: DocumentChunk,
): KnowledgeArticleBlockResponse {
  return {
    chunkIndex: chunk.chunkIndex,
    pageNumber: chunk.pageNumber ?? undefined,
    contentText: chunk.contentText,
  };
}

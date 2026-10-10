import {
  DocumentFlagResponse,
  toProtoDocumentFlagResolution,
  toProtoDocumentFlagSeverity,
  toProtoDocumentFlagType,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { DocumentFlag } from '../../generated/prisma/client';

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
    flagType: toProtoDocumentFlagType(flag.flagType),
    severity: toProtoDocumentFlagSeverity(flag.severity),
    detail: flag.detail,
    confidenceScore: flag.confidenceScore ?? undefined,
    detectedAt: toProtoTimestamp(flag.detectedAt),
    resolvedAt: toProtoTimestamp(flag.resolvedAt),
    resolvedById: flag.resolvedById ?? undefined,
    // UNSPECIFIED while the flag is open, which is what `toProto*` answers for
    // a null.
    resolution: toProtoDocumentFlagResolution(flag.resolution),
    resolutionComment: flag.resolutionComment ?? undefined,
    relatedDocumentId: flag.relatedDocumentId ?? undefined,
    relatedChunkId: flag.relatedChunkId ?? undefined,
  };
}

/** The relation `toDocumentFlagResponse` needs, declared once. */
export const DOCUMENT_FLAG_INCLUDE = {
  document: { select: { title: true } },
} as const;

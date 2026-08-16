import {
  DocumentChunkResponse,
  DocumentFlagResponse,
  DocumentResponse,
  fromProtoDocumentFileType,
  fromProtoDocumentFlagSeverity,
  fromProtoDocumentFlagType,
  fromProtoDocumentStatus,
  fromProtoTimestamp,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  DocumentChunkResponseDto,
  DocumentFlagResponseDto,
  DocumentResponseDto,
} from './dto/rest/document-response.dto';
import { DocumentResponseGqlDto } from './dto/graphql/document-response.gql-dto';
import {
  OCR_LANGUAGES,
  UNKNOWN_EXTENSION,
  type OcrLanguage,
} from '@synapsedesk/common';

export function toDocumentResponseDto(
  document: DocumentResponse,
): DocumentResponseDto {
  return {
    id: document.id,
    organizationId: document.organizationId,
    createdById: document.createdById,
    title: document.title,
    fileUrl: document.fileUrl,
    // `bin` rather than null, because it is a DESIGNED unknown: the confirm
    // path already files an accepted type with no extension mapping under it,
    // so an unrecognized value here joins rows that legitimately hold it.
    fileType: fromProtoDocumentFileType(document.fileType) ?? UNKNOWN_EXTENSION,
    // Valid by construction — the request DTO validates against the same list —
    // so this filter should never drop anything. It is here so the declared
    // `OcrLanguage[]` is a fact rather than a hope.
    ocrLanguages: document.ocrLanguages.filter((code): code is OcrLanguage =>
      (OCR_LANGUAGES as readonly string[]).includes(code),
    ),
    fileSizeBytes: document.fileSizeBytes,
    isOrganizationWide: document.isOrganizationWide,
    status: fromProtoDocumentStatus(document.status),
    departmentIds: document.departmentIds,
    chunkCount: document.chunkCount,
    createdAt: requireProtoTimestamp(document.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(document.updatedAt, 'updatedAt'),
    deletedAt: fromProtoTimestamp(document.deletedAt) ?? null,
    deletedById: document.deletedById ?? null,
  };
}

/**
 * Wire -> the GraphQL `type Document`.
 *
 * **A separate mapper rather than reusing {@link toDocumentResponseDto}**, which
 * is what the analytics edges did. That worked — `DocumentResponseDto` is a
 * superset, so it typechecks, and GraphQL drops the extras on the way out — and
 * it was the one place the REST/GraphQL split was not honoured. Two reasons it
 * is worth its own function:
 *
 *   - `fileUrl` is an internal object path the schema deliberately never
 *     exposes. Building it into an object handed to GraphQL made its absence
 *     from the response a property of the SERIALIZER rather than of the data,
 *     and "it gets pruned" is a weaker guarantee than "it was never read".
 *   - Every other edge in the gateway maps through a `…GqlDto` mapper. One
 *     borrowing the REST one is the kind of exception that reads as precedent.
 *
 * `deletedById` is dropped for the same reason: an audit field with no edge
 * behind it, recorded as REST-only in the contract spec.
 */
export function toDocumentResponseGqlDto(
  document: DocumentResponse,
): DocumentResponseGqlDto {
  return {
    id: document.id,
    organizationId: document.organizationId,
    createdById: document.createdById,
    title: document.title,
    fileType: fromProtoDocumentFileType(document.fileType) ?? UNKNOWN_EXTENSION,
    fileSizeBytes: document.fileSizeBytes,
    isOrganizationWide: document.isOrganizationWide,
    status: fromProtoDocumentStatus(document.status),
    departmentIds: document.departmentIds,
    chunkCount: document.chunkCount,
    createdAt: requireProtoTimestamp(document.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(document.updatedAt, 'updatedAt'),
    deletedAt: fromProtoTimestamp(document.deletedAt) ?? null,
  };
}

export function toDocumentChunkResponseDto(
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
    createdAt: requireProtoTimestamp(chunk.createdAt, 'createdAt'),
  };
}

export function toDocumentFlagResponseDto(
  flag: DocumentFlagResponse,
): DocumentFlagResponseDto {
  return {
    id: flag.id,
    documentId: flag.documentId,
    documentTitle: flag.documentTitle,
    // `| null` rather than a fallback, matching `status` above: there is no
    // "unknown flag type" a client could sensibly render, so the honest answer
    // is that this build does not recognise the value.
    flagType: fromProtoDocumentFlagType(flag.flagType),
    severity: fromProtoDocumentFlagSeverity(flag.severity),
    detail: flag.detail,
    // `?? null`: a flag raised by a rule rather than a model has no score, and
    // that is different from a score of zero.
    confidenceScore: flag.confidenceScore ?? null,
    detectedAt: requireProtoTimestamp(flag.detectedAt, 'detectedAt'),
  };
}

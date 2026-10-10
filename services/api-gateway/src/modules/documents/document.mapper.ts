import {
  ConfirmDocumentRequest,
  DocumentChunkResponse,
  DocumentFlagResponse,
  DocumentResponse,
  DownloadDocumentResponse,
  fromProtoDocumentFileType,
  fromProtoDocumentFlagResolution,
  fromProtoDocumentFlagSeverity,
  fromProtoDocumentFlagType,
  fromProtoDocumentStatus,
  fromProtoTimestamp,
  ListDocumentChunksResponse,
  ListDocumentFlagsRequest,
  ListDocumentFlagsResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  PresignDocumentResponse,
  requireProtoTimestamp,
  StorageUsageResponse,
  toPageRequest,
  toProtoDocumentFileType,
  toProtoDocumentFlagSeverity,
  toProtoDocumentFlagType,
  toProtoDocumentStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import {
  ConfirmDocumentDto,
  ListDocumentFlagsQueryDto,
  ListDocumentsQueryDto,
} from './dto/rest/document.dto';
import {
  DownloadDocumentResponseDto,
  PresignDocumentResponseDto,
  StorageUsageResponseDto,
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
    resolvedAt: fromProtoTimestamp(flag.resolvedAt) ?? null,
    resolvedById: flag.resolvedById ?? null,
    // UNSPECIFIED is what an OPEN flag sends, so null here means "not
    // resolved" rather than "value this build does not know".
    resolution: fromProtoDocumentFlagResolution(flag.resolution),
    resolutionComment: flag.resolutionComment ?? null,
    relatedDocumentId: flag.relatedDocumentId ?? null,
    relatedChunkId: flag.relatedChunkId ?? null,
  };
}

/** Builds a `ConfirmDocumentRequest` from the REST body. */
export function toConfirmDocumentRequest(
  dto: ConfirmDocumentDto,
): ConfirmDocumentRequest {
  return {
    objectPath: dto.objectPath,
    title: dto.title,
    isOrganizationWide: dto.isOrganizationWide,
    departmentIds: dto.departmentIds,
    ocrLanguages: dto.ocrLanguages,
    fileName: dto.fileName ?? '',
  };
}

/** Builds a `ListDocumentsRequest` from the REST query. */
export function toListDocumentsRequest(
  query: ListDocumentsQueryDto,
): ListDocumentsRequest {
  return {
    page: toPageRequest(query),
    departmentId: query.departmentId ?? '',
    status: toProtoDocumentStatus(query.status),
    fileType: toProtoDocumentFileType(query.fileType),
    includeDeleted: query.includeDeleted,
  };
}

/** Builds a `ListDocumentFlagsRequest` from the REST query. */
export function toListDocumentFlagsRequest(
  query: ListDocumentFlagsQueryDto,
): ListDocumentFlagsRequest {
  return {
    flagTypes: query.type.map(toProtoDocumentFlagType),
    includeResolved: query.includeResolved,
    page: toPageRequest(query),
    // UNSPECIFIED and '' are what the service reads as "no filter".
    severity: toProtoDocumentFlagSeverity(query.severity),
    documentId: query.documentId ?? '',
  };
}

/** Converts a `ListDocumentsResponse` into the paginated REST envelope. */
export function toDocumentPageDto(
  response: ListDocumentsResponse,
): PaginationResponseDto<DocumentResponseDto> {
  return {
    items: response.items.map(toDocumentResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListDocumentChunksResponse` into the paginated REST envelope. */
export function toDocumentChunkPageDto(
  response: ListDocumentChunksResponse,
): PaginationResponseDto<DocumentChunkResponseDto> {
  return {
    items: response.items.map(toDocumentChunkResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/** Converts a `ListDocumentFlagsResponse` into the paginated REST envelope. */
export function toDocumentFlagPageDto(
  response: ListDocumentFlagsResponse,
): PaginationResponseDto<DocumentFlagResponseDto> {
  return {
    items: response.items.map(toDocumentFlagResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `PresignDocumentResponse` off the wire into its REST DTO.
 *
 * @throws Error if `expiresAt` is missing, which the proto requires.
 */
export function toPresignDocumentResponseDto(
  response: PresignDocumentResponse,
): PresignDocumentResponseDto {
  return {
    uploadUrl: response.uploadUrl,
    objectPath: response.objectPath,
    expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
  };
}

/**
 * Converts a `DownloadDocumentResponse` off the wire into its REST DTO.
 *
 * @throws Error if `expiresAt` is missing, which the proto requires.
 */
export function toDownloadDocumentResponseDto(
  response: DownloadDocumentResponse,
): DownloadDocumentResponseDto {
  return {
    downloadUrl: response.downloadUrl,
    expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
  };
}

/** Converts a `StorageUsageResponse` off the wire into its REST DTO. */
export function toStorageUsageResponseDto(
  response: StorageUsageResponse,
): StorageUsageResponseDto {
  return {
    usedBytes: response.usedBytes,
    limitBytes: response.limitBytes,
    documentCount: response.documentCount,
  };
}

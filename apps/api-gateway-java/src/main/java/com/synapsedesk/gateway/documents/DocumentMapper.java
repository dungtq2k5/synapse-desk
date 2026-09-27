package com.synapsedesk.gateway.documents;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.ingestion.Document.DocumentResponse;
import synapsedesk.ingestion.Document.DocumentStatus;

/** Wire `DocumentResponse` -> the GraphQL DTO — `document.mapper.ts`, reproduced. */
public final class DocumentMapper {

  private DocumentMapper() {}

  public static DocumentGqlDto toDocumentGqlDto(DocumentResponse document) {
    return new DocumentGqlDto(
        document.getId(),
        document.getOrganizationId(),
        document.getCreatedById(),
        document.getTitle(),
        document.getFileType().name().replace("DOCUMENT_FILE_TYPE_", "").toLowerCase(java.util.Locale.ROOT),
        Math.toIntExact(document.getFileSizeBytes()),
        document.getIsOrganizationWide(),
        toStatusGql(document.getStatus()),
        document.getDepartmentIdsList(),
        document.getChunkCount(),
        toOffsetDateTime(document.getCreatedAt()),
        toOffsetDateTime(document.getUpdatedAt()),
        document.hasDeletedAt() ? toOffsetDateTime(document.getDeletedAt()) : null);
  }

  public static PageMetaGqlDto toPageMetaGqlDto(PageMeta meta) {
    return new PageMetaGqlDto(
        meta.getTotalItems(),
        meta.getItemCount(),
        meta.getItemsPerPage(),
        meta.getTotalPages(),
        meta.getCurrentPage());
  }

  /** `UNSPECIFIED` -> `null`, matching Node's "a value this build cannot name answers null". */
  private static DocumentStatusGql toStatusGql(DocumentStatus status) {
    return switch (status) {
      case DOCUMENT_STATUS_PENDING -> DocumentStatusGql.PENDING;
      case DOCUMENT_STATUS_PROCESSING -> DocumentStatusGql.PROCESSING;
      case DOCUMENT_STATUS_INDEXED -> DocumentStatusGql.INDEXED;
      case DOCUMENT_STATUS_FAILED -> DocumentStatusGql.FAILED;
      default -> null;
    };
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}

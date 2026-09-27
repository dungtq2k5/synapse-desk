package com.synapsedesk.gateway.ingestion;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;

/** Wire `IngestionJobResponse` -> the GraphQL DTO. */
public final class IngestionJobMapper {

  private IngestionJobMapper() {}

  public static IngestionJobGqlDto toIngestionJobGqlDto(IngestionJobResponse job) {
    return new IngestionJobGqlDto(
        job.getId(),
        job.getDocumentId(),
        job.getBullmqJobId(),
        toStatusGql(job.getStatus()),
        job.getErrorLog(),
        job.hasProcessedAt() ? toOffsetDateTime(job.getProcessedAt()) : null,
        toOffsetDateTime(job.getCreatedAt()));
  }

  /** `UNSPECIFIED` -> `null`: a member this build does not recognise nulls the field, not the row. */
  private static IngestionJobStatusGql toStatusGql(IngestionJobStatus status) {
    return switch (status) {
      case INGESTION_JOB_STATUS_QUEUED -> IngestionJobStatusGql.QUEUED;
      case INGESTION_JOB_STATUS_PARSING -> IngestionJobStatusGql.PARSING;
      case INGESTION_JOB_STATUS_CHUNKING -> IngestionJobStatusGql.CHUNKING;
      case INGESTION_JOB_STATUS_EMBEDDING -> IngestionJobStatusGql.EMBEDDING;
      case INGESTION_JOB_STATUS_COMPLETED -> IngestionJobStatusGql.COMPLETED;
      case INGESTION_JOB_STATUS_FAILED -> IngestionJobStatusGql.FAILED;
      case INGESTION_JOB_STATUS_CANCELLED -> IngestionJobStatusGql.CANCELLED;
      default -> null;
    };
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}

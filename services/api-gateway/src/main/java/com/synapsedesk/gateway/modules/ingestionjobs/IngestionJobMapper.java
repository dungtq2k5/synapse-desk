package com.synapsedesk.gateway.modules.ingestionjobs;

import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionErrorCodeGql;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobGqlDto;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobStatusGql;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionStageGql;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionWaitingReasonGql;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.rest.IngestionJobResponseDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.ingestion.Document.IngestionErrorCode;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;
import synapsedesk.ingestion.Document.IngestionStage;
import synapsedesk.ingestion.Document.IngestionWaitingReason;

/**
 * Wire ingestion job -> the REST DTO and the GraphQL one.
 *
 * <p>The REST DTO is shared by {@code
 * IngestionJobsController} (this interface) and {@code DocumentsController}
 * (its own {@code GET /documents/:id/ingestion-jobs} row): one mapper,
 * imported by both controllers, so the two surfaces can never independently
 * drift on what a job row exposes.
 *
 * <p><b>{@code errorLog} is capped, not forwarded raw.</b> {@code fail()}
 * writes whatever the thrower said — signed storage URLs, Postgres errors
 * quoting column values, embedding-API 4xx bodies that echo a prefix of the
 * rejected input — and this REST surface hands that to any {@code
 * document.read} holder. The cap bounds the AUDIENCE this route has, not
 * the field: gRPC's own {@code GetIngestionJob} still returns it in full.
 * No Bean Validation annotation can express this (it is a transform, not a
 * constraint), so the generated {@code IngestionJobResponseDto.errorLog}
 * carries no hint of it at all — hand-replicated here, the same
 * generator-validation defect shape as a validator the generator drops, one
 * field position over.
 */
public final class IngestionJobMapper {

  private static final int ERROR_LOG_MAX_CHARS = 500;

  private IngestionJobMapper() {}

  public static IngestionJobResponseDto toDto(IngestionJobResponse job) {
    return new IngestionJobResponseDto(
      job.getId(),
      job.getDocumentId(),
      job.getBullmqJobId(),
      IngestionJobResponseDto.StatusEnum.fromValue(
        job.getStatus().name().replace("INGESTION_JOB_STATUS_", "")
      ),
      toErrorLog(job.getErrorLog()),
      IngestionJobResponseDto.ErrorCodeEnum.fromValue(
        member(job.getErrorCode(), "INGESTION_ERROR_CODE_")
      ),
      IngestionJobResponseDto.FailedStageEnum.fromValue(
        member(job.getFailedStage(), "INGESTION_STAGE_")
      ),
      IngestionJobResponseDto.WaitingReasonEnum.fromValue(
        member(job.getWaitingReason(), "INGESTION_WAITING_REASON_")
      ),
      job.hasProcessedAt() ? toOffsetDateTime(job.getProcessedAt()) : null,
      toOffsetDateTime(job.getCreatedAt())
    );
  }

  public static IngestionJobGqlDto toIngestionJobGqlDto(
    IngestionJobResponse job
  ) {
    return new IngestionJobGqlDto(
      job.getId(),
      job.getDocumentId(),
      job.getBullmqJobId(),
      toStatusGql(job.getStatus()),
      job.getErrorLog(),
      toErrorCodeGql(job.getErrorCode()),
      toStageGql(job.getFailedStage()),
      toWaitingReasonGql(job.getWaitingReason()),
      job.hasProcessedAt() ? toOffsetDateTime(job.getProcessedAt()) : null,
      toOffsetDateTime(job.getCreatedAt())
    );
  }

  /**
   * A wire member's domain name: the prefix dropped. UNSPECIFIED and an
   * unknown member find no enum constant, so the field reads {@code null}.
   */
  private static String member(Enum<?> value, String prefix) {
    return value.name().replace(prefix, "");
  }

  private static IngestionErrorCodeGql toErrorCodeGql(IngestionErrorCode code) {
    return switch (code) {
      case INGESTION_ERROR_CODE_TOO_LONG -> IngestionErrorCodeGql.TOO_LONG;
      case INGESTION_ERROR_CODE_NO_READABLE_TEXT -> IngestionErrorCodeGql.NO_READABLE_TEXT;
      case INGESTION_ERROR_CODE_OCR_UNAVAILABLE -> IngestionErrorCodeGql.OCR_UNAVAILABLE;
      case INGESTION_ERROR_CODE_PROVIDER_FAILURE -> IngestionErrorCodeGql.PROVIDER_FAILURE;
      case INGESTION_ERROR_CODE_OTHER -> IngestionErrorCodeGql.OTHER;
      default -> null;
    };
  }

  private static IngestionStageGql toStageGql(IngestionStage stage) {
    return switch (stage) {
      case INGESTION_STAGE_PARSING -> IngestionStageGql.PARSING;
      case INGESTION_STAGE_CHUNKING -> IngestionStageGql.CHUNKING;
      case INGESTION_STAGE_EMBEDDING -> IngestionStageGql.EMBEDDING;
      default -> null;
    };
  }

  private static IngestionWaitingReasonGql toWaitingReasonGql(
    IngestionWaitingReason reason
  ) {
    return switch (reason) {
      case INGESTION_WAITING_REASON_AI_ALLOWANCE -> IngestionWaitingReasonGql.AI_ALLOWANCE;
      default -> null;
    };
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

  /** {@code ""} on the wire is proto3's absent scalar; REST commits to {@code null}. */
  private static String toErrorLog(String errorLog) {
    if (errorLog == null || errorLog.isEmpty()) {
      return null;
    }
    return errorLog.length() > ERROR_LOG_MAX_CHARS
      ? errorLog.substring(0, ERROR_LOG_MAX_CHARS) + "…"
      : errorLog;
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}

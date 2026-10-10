package com.synapsedesk.gateway.ingestionjobs;

import com.synapsedesk.gateway.model.IngestionJobResponseDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.ingestion.Document.IngestionJobResponse;

/**
 * Wire ingestion job -> REST DTO, shared by {@code
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
      job.hasProcessedAt() ? toOffsetDateTime(job.getProcessedAt()) : null,
      toOffsetDateTime(job.getCreatedAt())
    );
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

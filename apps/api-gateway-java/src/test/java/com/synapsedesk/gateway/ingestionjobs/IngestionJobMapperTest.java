package com.synapsedesk.gateway.ingestionjobs;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.generated.model.IngestionJobResponseDto;
import org.junit.jupiter.api.Test;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;

/**
 * `ingestion-job.mapper.ts`'s `toErrorLog`, reproduced: an empty wire
 * scalar commits to {@code null}, and anything past 500 characters is cut
 * with a trailing ellipsis — the audience bound this route has, not a
 * property of the field (gRPC's own `GetIngestionJob` still returns it in
 * full).
 */
class IngestionJobMapperTest {

  private static IngestionJobResponse.Builder wire() {
    Timestamp now = Timestamp.newBuilder().setSeconds(1_756_684_800).build();
    return IngestionJobResponse.newBuilder()
      .setId("job-1")
      .setDocumentId("doc-1")
      .setBullmqJobId("bullmq-1")
      .setStatus(IngestionJobStatus.INGESTION_JOB_STATUS_FAILED)
      .setCreatedAt(now);
  }

  @Test
  void anEmptyErrorLogBecomesNull() {
    IngestionJobResponseDto dto = IngestionJobMapper.toDto(
      wire().setErrorLog("").build()
    );

    assertThat(dto.getErrorLog()).isNull();
  }

  @Test
  void aShortErrorLogPassesThroughUntouched() {
    IngestionJobResponseDto dto = IngestionJobMapper.toDto(
      wire().setErrorLog("parse failed").build()
    );

    assertThat(dto.getErrorLog()).isEqualTo("parse failed");
  }

  @Test
  void aLongErrorLogIsCutAt500CharsWithAnEllipsis() {
    String raw = "x".repeat(600);

    IngestionJobResponseDto dto = IngestionJobMapper.toDto(
      wire().setErrorLog(raw).build()
    );

    assertThat(dto.getErrorLog()).hasSize(501);
    assertThat(dto.getErrorLog()).startsWith("x".repeat(500));
    assertThat(dto.getErrorLog()).endsWith("…");
  }

  @Test
  void anExactly500CharErrorLogIsNotTruncated() {
    String raw = "x".repeat(500);

    IngestionJobResponseDto dto = IngestionJobMapper.toDto(
      wire().setErrorLog(raw).build()
    );

    assertThat(dto.getErrorLog()).isEqualTo(raw);
  }
}

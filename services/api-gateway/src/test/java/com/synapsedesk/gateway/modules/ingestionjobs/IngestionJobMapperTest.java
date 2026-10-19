package com.synapsedesk.gateway.modules.ingestionjobs;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.protobuf.ProtocolMessageEnum;
import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql.IngestionJobGqlDto;
import com.synapsedesk.gateway.modules.ingestionjobs.dto.rest.IngestionJobResponseDto;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import synapsedesk.ingestion.Document.IngestionErrorCode;
import synapsedesk.ingestion.Document.IngestionJobResponse;
import synapsedesk.ingestion.Document.IngestionJobStatus;
import synapsedesk.ingestion.Document.IngestionStage;
import synapsedesk.ingestion.Document.IngestionWaitingReason;
import tools.jackson.databind.ObjectMapper;

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

  /** A wire enum's members a build can name: not UNSPECIFIED, not UNRECOGNIZED. */
  private static <E extends Enum<E> & ProtocolMessageEnum> Stream<E> named(
    Class<E> type
  ) {
    return Arrays.stream(type.getEnumConstants()).filter(
      member ->
        !member.name().endsWith("UNSPECIFIED") &&
        !"UNRECOGNIZED".equals(member.name())
    );
  }

  static Stream<IngestionJobStatus> statuses() {
    return named(IngestionJobStatus.class);
  }

  static Stream<IngestionErrorCode> errorCodes() {
    return named(IngestionErrorCode.class);
  }

  static Stream<IngestionStage> stages() {
    return named(IngestionStage.class);
  }

  static Stream<IngestionWaitingReason> waitingReasons() {
    return named(IngestionWaitingReason.class);
  }

  @ParameterizedTest
  @MethodSource("statuses")
  void everyStatusIsTheSameMemberOnBothSurfaces(IngestionJobStatus status) {
    IngestionJobResponse job = wire().setStatus(status).build();
    String name = status.name().replace("INGESTION_JOB_STATUS_", "");

    assertThat(IngestionJobMapper.toDto(job).getStatus().getValue()).isEqualTo(
      name
    );
    assertThat(
      IngestionJobMapper.toIngestionJobGqlDto(job).status().name()
    ).isEqualTo(name);
  }

  @ParameterizedTest
  @MethodSource("errorCodes")
  void everyErrorCodeIsTheSameMemberOnBothSurfaces(IngestionErrorCode code) {
    IngestionJobResponse job = wire().setErrorCode(code).build();
    String name = code.name().replace("INGESTION_ERROR_CODE_", "");

    assertThat(
      IngestionJobMapper.toDto(job).getErrorCode().getValue()
    ).isEqualTo(name);
    assertThat(
      IngestionJobMapper.toIngestionJobGqlDto(job).errorCode().name()
    ).isEqualTo(name);
  }

  @ParameterizedTest
  @MethodSource("stages")
  void everyStageIsTheSameMemberOnBothSurfaces(IngestionStage stage) {
    IngestionJobResponse job = wire().setFailedStage(stage).build();
    String name = stage.name().replace("INGESTION_STAGE_", "");

    assertThat(
      IngestionJobMapper.toDto(job).getFailedStage().getValue()
    ).isEqualTo(name);
    assertThat(
      IngestionJobMapper.toIngestionJobGqlDto(job).failedStage().name()
    ).isEqualTo(name);
  }

  @ParameterizedTest
  @MethodSource("waitingReasons")
  void everyWaitingReasonIsTheSameMemberOnBothSurfaces(
    IngestionWaitingReason reason
  ) {
    IngestionJobResponse job = wire().setWaitingReason(reason).build();
    String name = reason.name().replace("INGESTION_WAITING_REASON_", "");

    assertThat(
      IngestionJobMapper.toDto(job).getWaitingReason().getValue()
    ).isEqualTo(name);
    assertThat(
      IngestionJobMapper.toIngestionJobGqlDto(job).waitingReason().name()
    ).isEqualTo(name);
  }

  @Test
  void unspecifiedMembersAndNoProcessedAtAreNullOnBothSurfaces() {
    IngestionJobResponse job = wire()
      .setStatus(IngestionJobStatus.INGESTION_JOB_STATUS_UNSPECIFIED)
      .build();

    IngestionJobResponseDto rest = IngestionJobMapper.toDto(job);
    IngestionJobGqlDto gql = IngestionJobMapper.toIngestionJobGqlDto(job);

    assertThat(rest.getErrorCode()).isNull();
    assertThat(rest.getFailedStage()).isNull();
    assertThat(rest.getWaitingReason()).isNull();
    assertThat(rest.getProcessedAt()).isNull();
    assertThat(gql.status()).isNull();
    assertThat(gql.errorCode()).isNull();
    assertThat(gql.failedStage()).isNull();
    assertThat(gql.waitingReason()).isNull();
    assertThat(gql.processedAt()).isNull();
  }

  @Test
  void aProcessedAtIsUtcOnBothSurfaces() {
    IngestionJobResponse job = wire()
      .setProcessedAt(Timestamp.newBuilder().setSeconds(1_756_684_860).build())
      .build();

    OffsetDateTime expected = OffsetDateTime.parse("2025-09-01T00:01:00Z");
    assertThat(IngestionJobMapper.toDto(job).getProcessedAt()).isEqualTo(
      expected
    );
    assertThat(
      IngestionJobMapper.toIngestionJobGqlDto(job).processedAt()
    ).isEqualTo(expected);
  }

  /** The REST row as a client reads it: every field through JSON and back. */
  @Test
  void aJobRowRoundTripsThroughJsonWithEveryField() {
    IngestionJobResponseDto row = IngestionJobMapper.toDto(
      wire()
        .setErrorLog("parse failed")
        .setErrorCode(IngestionErrorCode.INGESTION_ERROR_CODE_TOO_LONG)
        .setFailedStage(IngestionStage.INGESTION_STAGE_PARSING)
        .setWaitingReason(
          IngestionWaitingReason.INGESTION_WAITING_REASON_AI_ALLOWANCE
        )
        .build()
    );
    ObjectMapper json = new ObjectMapper();

    IngestionJobResponseDto back = json.readValue(
      json.writeValueAsString(row),
      IngestionJobResponseDto.class
    );

    assertThat(back).isEqualTo(row).hasSameHashCodeAs(row);
    assertThat(row.toString())
      .contains("errorCode: TOO_LONG")
      .contains("failedStage: PARSING")
      .contains("waitingReason: AI_ALLOWANCE");
    assertThat(
      new IngestionJobResponseDto(
        "job-1",
        "doc-1",
        "bullmq-1",
        null,
        null,
        null,
        null,
        null,
        null,
        null
      )
        .errorCode(IngestionJobResponseDto.ErrorCodeEnum.OTHER)
        .failedStage(IngestionJobResponseDto.FailedStageEnum.EMBEDDING)
        .waitingReason(IngestionJobResponseDto.WaitingReasonEnum.AI_ALLOWANCE)
    ).isNotEqualTo(row);
  }
}

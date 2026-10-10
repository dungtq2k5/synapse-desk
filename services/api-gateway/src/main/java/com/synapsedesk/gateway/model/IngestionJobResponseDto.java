package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * IngestionJobResponseDto
 */

public class IngestionJobResponseDto {

  private String id;

  private String documentId;

  private String bullmqJobId;

  /**
   * `null` only if the peer sent a member this build does not know.
   */
  public enum StatusEnum {
    CANCELLED("CANCELLED"),

    CHUNKING("CHUNKING"),

    COMPLETED("COMPLETED"),

    EMBEDDING("EMBEDDING"),

    FAILED("FAILED"),

    PARSING("PARSING"),

    QUEUED("QUEUED");

    private final String value;

    StatusEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private StatusEnum status = null;

  private String errorLog = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime processedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public IngestionJobResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public IngestionJobResponseDto(
    String id,
    String documentId,
    String bullmqJobId,
    StatusEnum status,
    String errorLog,
    OffsetDateTime processedAt,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.documentId = documentId;
    this.bullmqJobId = bullmqJobId;
    this.status = status;
    this.errorLog = errorLog;
    this.processedAt = processedAt;
    this.createdAt = createdAt;
  }

  public IngestionJobResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public IngestionJobResponseDto documentId(String documentId) {
    this.documentId = documentId;
    return this;
  }

  /**
   * Get documentId
   * @return documentId
   */
  @NotNull
  @JsonProperty("documentId")
  public String getDocumentId() {
    return documentId;
  }

  @JsonProperty("documentId")
  public void setDocumentId(String documentId) {
    this.documentId = documentId;
  }

  public IngestionJobResponseDto bullmqJobId(String bullmqJobId) {
    this.bullmqJobId = bullmqJobId;
    return this;
  }

  /**
   * Empty until the worker has queued it.
   * @return bullmqJobId
   */
  @NotNull
  @JsonProperty("bullmqJobId")
  public String getBullmqJobId() {
    return bullmqJobId;
  }

  @JsonProperty("bullmqJobId")
  public void setBullmqJobId(String bullmqJobId) {
    this.bullmqJobId = bullmqJobId;
  }

  public IngestionJobResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `null` only if the peer sent a member this build does not know.
   * @return status
   */

  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public IngestionJobResponseDto errorLog(String errorLog) {
    this.errorLog = errorLog;
    return this;
  }

  /**
   * Get errorLog
   * @return errorLog
   */

  @JsonProperty("errorLog")
  public String getErrorLog() {
    return errorLog;
  }

  @JsonProperty("errorLog")
  public void setErrorLog(String errorLog) {
    this.errorLog = errorLog;
  }

  public IngestionJobResponseDto processedAt(OffsetDateTime processedAt) {
    this.processedAt = processedAt;
    return this;
  }

  /**
   * `null` while the attempt is still running.
   * @return processedAt
   */
  @Valid
  @JsonProperty("processedAt")
  public OffsetDateTime getProcessedAt() {
    return processedAt;
  }

  @JsonProperty("processedAt")
  public void setProcessedAt(OffsetDateTime processedAt) {
    this.processedAt = processedAt;
  }

  public IngestionJobResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    IngestionJobResponseDto ingestionJobResponseDto =
      (IngestionJobResponseDto) o;
    return (
      Objects.equals(this.id, ingestionJobResponseDto.id) &&
      Objects.equals(this.documentId, ingestionJobResponseDto.documentId) &&
      Objects.equals(this.bullmqJobId, ingestionJobResponseDto.bullmqJobId) &&
      Objects.equals(this.status, ingestionJobResponseDto.status) &&
      Objects.equals(this.errorLog, ingestionJobResponseDto.errorLog) &&
      Objects.equals(this.processedAt, ingestionJobResponseDto.processedAt) &&
      Objects.equals(this.createdAt, ingestionJobResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      documentId,
      bullmqJobId,
      status,
      errorLog,
      processedAt,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class IngestionJobResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    bullmqJobId: ")
      .append(toIndentedString(bullmqJobId))
      .append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    errorLog: ").append(toIndentedString(errorLog)).append("\n");
    sb.append("    processedAt: ")
      .append(toIndentedString(processedAt))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("}");
    return sb.toString();
  }

  /**
   * Convert the given object to string with each line indented by 4 spaces
   * (except the first line).
   */
  private String toIndentedString(@Nullable Object o) {
    return o == null ? "null" : o.toString().replace("\n", "\n    ");
  }
}

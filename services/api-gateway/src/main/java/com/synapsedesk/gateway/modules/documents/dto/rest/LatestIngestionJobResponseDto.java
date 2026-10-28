package com.synapsedesk.gateway.modules.documents.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * LatestIngestionJobResponseDto
 */

public class LatestIngestionJobResponseDto {

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

  /**
   * Why a `QUEUED` attempt waits; `null` is an ordinary queue.
   */
  public enum WaitingReasonEnum {
    AI_ALLOWANCE("AI_ALLOWANCE");

    private final String value;

    WaitingReasonEnum(String value) {
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
    public static WaitingReasonEnum fromValue(String value) {
      for (WaitingReasonEnum b : WaitingReasonEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private WaitingReasonEnum waitingReason = null;

  /**
   * Why a `FAILED` attempt failed; `null` on one that hasn't failed.
   */
  public enum ErrorCodeEnum {
    NO_READABLE_TEXT("NO_READABLE_TEXT"),

    OCR_UNAVAILABLE("OCR_UNAVAILABLE"),

    OTHER("OTHER"),

    PROVIDER_FAILURE("PROVIDER_FAILURE"),

    TOO_LONG("TOO_LONG");

    private final String value;

    ErrorCodeEnum(String value) {
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
    public static ErrorCodeEnum fromValue(String value) {
      for (ErrorCodeEnum b : ErrorCodeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private ErrorCodeEnum errorCode = null;

  public LatestIngestionJobResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public LatestIngestionJobResponseDto(
    StatusEnum status,
    WaitingReasonEnum waitingReason,
    ErrorCodeEnum errorCode
  ) {
    this.status = status;
    this.waitingReason = waitingReason;
    this.errorCode = errorCode;
  }

  public LatestIngestionJobResponseDto status(StatusEnum status) {
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

  public LatestIngestionJobResponseDto waitingReason(
    WaitingReasonEnum waitingReason
  ) {
    this.waitingReason = waitingReason;
    return this;
  }

  /**
   * Why a `QUEUED` attempt waits; `null` is an ordinary queue.
   * @return waitingReason
   */

  @JsonProperty("waitingReason")
  public WaitingReasonEnum getWaitingReason() {
    return waitingReason;
  }

  @JsonProperty("waitingReason")
  public void setWaitingReason(WaitingReasonEnum waitingReason) {
    this.waitingReason = waitingReason;
  }

  public LatestIngestionJobResponseDto errorCode(ErrorCodeEnum errorCode) {
    this.errorCode = errorCode;
    return this;
  }

  /**
   * Why a `FAILED` attempt failed; `null` on one that hasn't failed.
   * @return errorCode
   */

  @JsonProperty("errorCode")
  public ErrorCodeEnum getErrorCode() {
    return errorCode;
  }

  @JsonProperty("errorCode")
  public void setErrorCode(ErrorCodeEnum errorCode) {
    this.errorCode = errorCode;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    LatestIngestionJobResponseDto latestIngestionJobResponseDto =
      (LatestIngestionJobResponseDto) o;
    return (
      Objects.equals(this.status, latestIngestionJobResponseDto.status) &&
      Objects.equals(
        this.waitingReason,
        latestIngestionJobResponseDto.waitingReason
      ) &&
      Objects.equals(this.errorCode, latestIngestionJobResponseDto.errorCode)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(status, waitingReason, errorCode);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LatestIngestionJobResponseDto {\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    waitingReason: ")
      .append(toIndentedString(waitingReason))
      .append("\n");
    sb.append("    errorCode: ")
      .append(toIndentedString(errorCode))
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

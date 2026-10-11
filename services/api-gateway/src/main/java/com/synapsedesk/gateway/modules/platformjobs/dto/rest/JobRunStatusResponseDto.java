package com.synapsedesk.gateway.modules.platformjobs.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * JobRunStatusResponseDto
 */

public class JobRunStatusResponseDto {

  /**
   * Which service owns the schedule — the two have separate databases.
   */
  public enum ServiceEnum {
    AUTH_SERVICE("auth-service"),

    INGESTION_SERVICE("ingestion-service"),

    NOTIFICATION_SERVICE("notification-service"),

    RAG_SERVICE("rag-service"),

    STORAGE_SERVICE("storage-service"),

    TICKET_SERVICE("ticket-service");

    private final String value;

    ServiceEnum(String value) {
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
    public static ServiceEnum fromValue(String value) {
      for (ServiceEnum b : ServiceEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private ServiceEnum service;

  private String jobName;

  private String lastStartedAt = null;

  private String lastSucceededAt = null;

  private BigDecimal lastDurationMs = null;

  private String lastError = null;

  private BigDecimal consecutiveFailures;

  /**
   * How this row is doing — see {@link JobHealth} for the five values.  Computed here rather than stored, because the judgement needs the list of jobs this build EXPECTS: a job that has never run has no row, and a reader that only looks at the rows it finds reports nothing wrong.
   */
  public enum HealthEnum {
    FAILING("failing"),

    HEALTHY("healthy"),

    NEVER_RAN("never-ran"),

    STALE("stale"),

    STEP("step");

    private final String value;

    HealthEnum(String value) {
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
    public static HealthEnum fromValue(String value) {
      for (HealthEnum b : HealthEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private HealthEnum health;

  public JobRunStatusResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public JobRunStatusResponseDto(
    ServiceEnum service,
    String jobName,
    String lastStartedAt,
    String lastSucceededAt,
    BigDecimal lastDurationMs,
    String lastError,
    BigDecimal consecutiveFailures,
    HealthEnum health
  ) {
    this.service = service;
    this.jobName = jobName;
    this.lastStartedAt = lastStartedAt;
    this.lastSucceededAt = lastSucceededAt;
    this.lastDurationMs = lastDurationMs;
    this.lastError = lastError;
    this.consecutiveFailures = consecutiveFailures;
    this.health = health;
  }

  public JobRunStatusResponseDto service(ServiceEnum service) {
    this.service = service;
    return this;
  }

  /**
   * Which service owns the schedule — the two have separate databases.
   * @return service
   */
  @NotNull
  @JsonProperty("service")
  public ServiceEnum getService() {
    return service;
  }

  @JsonProperty("service")
  public void setService(ServiceEnum service) {
    this.service = service;
  }

  public JobRunStatusResponseDto jobName(String jobName) {
    this.jobName = jobName;
    return this;
  }

  /**
   * Get jobName
   * @return jobName
   */
  @NotNull
  @JsonProperty("jobName")
  public String getJobName() {
    return jobName;
  }

  @JsonProperty("jobName")
  public void setJobName(String jobName) {
    this.jobName = jobName;
  }

  public JobRunStatusResponseDto lastStartedAt(String lastStartedAt) {
    this.lastStartedAt = lastStartedAt;
    return this;
  }

  /**
   * Get lastStartedAt
   * @return lastStartedAt
   */

  @JsonProperty("lastStartedAt")
  public String getLastStartedAt() {
    return lastStartedAt;
  }

  @JsonProperty("lastStartedAt")
  public void setLastStartedAt(String lastStartedAt) {
    this.lastStartedAt = lastStartedAt;
  }

  public JobRunStatusResponseDto lastSucceededAt(String lastSucceededAt) {
    this.lastSucceededAt = lastSucceededAt;
    return this;
  }

  /**
   * Get lastSucceededAt
   * @return lastSucceededAt
   */

  @JsonProperty("lastSucceededAt")
  public String getLastSucceededAt() {
    return lastSucceededAt;
  }

  @JsonProperty("lastSucceededAt")
  public void setLastSucceededAt(String lastSucceededAt) {
    this.lastSucceededAt = lastSucceededAt;
  }

  public JobRunStatusResponseDto lastDurationMs(BigDecimal lastDurationMs) {
    this.lastDurationMs = lastDurationMs;
    return this;
  }

  /**
   * Get lastDurationMs
   * @return lastDurationMs
   */
  @Valid
  @JsonProperty("lastDurationMs")
  public BigDecimal getLastDurationMs() {
    return lastDurationMs;
  }

  @JsonProperty("lastDurationMs")
  public void setLastDurationMs(BigDecimal lastDurationMs) {
    this.lastDurationMs = lastDurationMs;
  }

  public JobRunStatusResponseDto lastError(String lastError) {
    this.lastError = lastError;
    return this;
  }

  /**
   * Get lastError
   * @return lastError
   */

  @JsonProperty("lastError")
  public String getLastError() {
    return lastError;
  }

  @JsonProperty("lastError")
  public void setLastError(String lastError) {
    this.lastError = lastError;
  }

  public JobRunStatusResponseDto consecutiveFailures(
    BigDecimal consecutiveFailures
  ) {
    this.consecutiveFailures = consecutiveFailures;
    return this;
  }

  /**
   * Get consecutiveFailures
   * @return consecutiveFailures
   */
  @NotNull
  @Valid
  @JsonProperty("consecutiveFailures")
  public BigDecimal getConsecutiveFailures() {
    return consecutiveFailures;
  }

  @JsonProperty("consecutiveFailures")
  public void setConsecutiveFailures(BigDecimal consecutiveFailures) {
    this.consecutiveFailures = consecutiveFailures;
  }

  public JobRunStatusResponseDto health(HealthEnum health) {
    this.health = health;
    return this;
  }

  /**
   * How this row is doing — see {@link JobHealth} for the five values.  Computed here rather than stored, because the judgement needs the list of jobs this build EXPECTS: a job that has never run has no row, and a reader that only looks at the rows it finds reports nothing wrong.
   * @return health
   */
  @NotNull
  @JsonProperty("health")
  public HealthEnum getHealth() {
    return health;
  }

  @JsonProperty("health")
  public void setHealth(HealthEnum health) {
    this.health = health;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    JobRunStatusResponseDto jobRunStatusResponseDto =
      (JobRunStatusResponseDto) o;
    return (
      Objects.equals(this.service, jobRunStatusResponseDto.service) &&
      Objects.equals(this.jobName, jobRunStatusResponseDto.jobName) &&
      Objects.equals(
        this.lastStartedAt,
        jobRunStatusResponseDto.lastStartedAt
      ) &&
      Objects.equals(
        this.lastSucceededAt,
        jobRunStatusResponseDto.lastSucceededAt
      ) &&
      Objects.equals(
        this.lastDurationMs,
        jobRunStatusResponseDto.lastDurationMs
      ) &&
      Objects.equals(this.lastError, jobRunStatusResponseDto.lastError) &&
      Objects.equals(
        this.consecutiveFailures,
        jobRunStatusResponseDto.consecutiveFailures
      ) &&
      Objects.equals(this.health, jobRunStatusResponseDto.health)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      service,
      jobName,
      lastStartedAt,
      lastSucceededAt,
      lastDurationMs,
      lastError,
      consecutiveFailures,
      health
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class JobRunStatusResponseDto {\n");
    sb.append("    service: ").append(toIndentedString(service)).append("\n");
    sb.append("    jobName: ").append(toIndentedString(jobName)).append("\n");
    sb.append("    lastStartedAt: ")
      .append(toIndentedString(lastStartedAt))
      .append("\n");
    sb.append("    lastSucceededAt: ")
      .append(toIndentedString(lastSucceededAt))
      .append("\n");
    sb.append("    lastDurationMs: ")
      .append(toIndentedString(lastDurationMs))
      .append("\n");
    sb.append("    lastError: ")
      .append(toIndentedString(lastError))
      .append("\n");
    sb.append("    consecutiveFailures: ")
      .append(toIndentedString(consecutiveFailures))
      .append("\n");
    sb.append("    health: ").append(toIndentedString(health)).append("\n");
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

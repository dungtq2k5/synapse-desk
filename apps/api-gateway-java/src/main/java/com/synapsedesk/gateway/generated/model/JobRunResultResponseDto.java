package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * JobRunResultResponseDto
 */

public class JobRunResultResponseDto {

  /**
   * Gets or Sets service
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

  /**
   * Gets or Sets jobName
   */
  public enum JobNameEnum {
    ANALYTICS_DAILY("analytics-daily"),
    
    AUTH_DAILY("auth-daily"),
    
    AUTH_HOURLY("auth-hourly"),
    
    BILLING_SNAPSHOT("billing-snapshot"),
    
    INGESTION_RECONCILE("ingestion-reconcile"),
    
    LEDGER_DAILY("ledger-daily"),
    
    LEDGER_HOURLY("ledger-hourly"),
    
    SCOPE_RECONCILE("scope-reconcile"),
    
    WEBHOOK_RETENTION("webhook-retention");

    private final String value;

    JobNameEnum(String value) {
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
    public static JobNameEnum fromValue(String value) {
      for (JobNameEnum b : JobNameEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private JobNameEnum jobName;

  private BigDecimal tenants;

  private BigDecimal rows;

  public JobRunResultResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public JobRunResultResponseDto(ServiceEnum service, JobNameEnum jobName, BigDecimal tenants, BigDecimal rows) {
    this.service = service;
    this.jobName = jobName;
    this.tenants = tenants;
    this.rows = rows;
  }

  public JobRunResultResponseDto service(ServiceEnum service) {
    this.service = service;
    return this;
  }

  /**
   * Get service
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

  public JobRunResultResponseDto jobName(JobNameEnum jobName) {
    this.jobName = jobName;
    return this;
  }

  /**
   * Get jobName
   * @return jobName
   */
  @NotNull 
  @JsonProperty("jobName")
  public JobNameEnum getJobName() {
    return jobName;
  }

  @JsonProperty("jobName")
  public void setJobName(JobNameEnum jobName) {
    this.jobName = jobName;
  }

  public JobRunResultResponseDto tenants(BigDecimal tenants) {
    this.tenants = tenants;
    return this;
  }

  /**
   * Get tenants
   * @return tenants
   */
  @NotNull @Valid 
  @JsonProperty("tenants")
  public BigDecimal getTenants() {
    return tenants;
  }

  @JsonProperty("tenants")
  public void setTenants(BigDecimal tenants) {
    this.tenants = tenants;
  }

  public JobRunResultResponseDto rows(BigDecimal rows) {
    this.rows = rows;
    return this;
  }

  /**
   * Get rows
   * @return rows
   */
  @NotNull @Valid 
  @JsonProperty("rows")
  public BigDecimal getRows() {
    return rows;
  }

  @JsonProperty("rows")
  public void setRows(BigDecimal rows) {
    this.rows = rows;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    JobRunResultResponseDto jobRunResultResponseDto = (JobRunResultResponseDto) o;
    return Objects.equals(this.service, jobRunResultResponseDto.service) &&
        Objects.equals(this.jobName, jobRunResultResponseDto.jobName) &&
        Objects.equals(this.tenants, jobRunResultResponseDto.tenants) &&
        Objects.equals(this.rows, jobRunResultResponseDto.rows);
  }

  @Override
  public int hashCode() {
    return Objects.hash(service, jobName, tenants, rows);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class JobRunResultResponseDto {\n");
    sb.append("    service: ").append(toIndentedString(service)).append("\n");
    sb.append("    jobName: ").append(toIndentedString(jobName)).append("\n");
    sb.append("    tenants: ").append(toIndentedString(tenants)).append("\n");
    sb.append("    rows: ").append(toIndentedString(rows)).append("\n");
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


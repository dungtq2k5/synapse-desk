package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * ExportResponseDto
 */

public class ExportResponseDto {

  private String id;

  /**
   * Gets or Sets status
   */
  public enum StatusEnum {
    FAILED("FAILED"),
    
    PENDING("PENDING"),
    
    READY("READY");

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
   * Gets or Sets kind
   */
  public enum KindEnum {
    AGENT_DAILY("AGENT_DAILY"),
    
    AUDIT_LOG("AUDIT_LOG"),
    
    TICKET("TICKET"),
    
    TICKET_DAILY("TICKET_DAILY");

    private final String value;

    KindEnum(String value) {
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
    public static KindEnum fromValue(String value) {
      for (KindEnum b : KindEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private KindEnum kind = null;

  private BigDecimal rowCount = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime rollupComputedAt = null;

  private String downloadUrl = null;

  private String error = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime completedAt = null;

  public ExportResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ExportResponseDto(String id, StatusEnum status, KindEnum kind, BigDecimal rowCount, OffsetDateTime rollupComputedAt, String downloadUrl, String error, OffsetDateTime createdAt, OffsetDateTime completedAt) {
    this.id = id;
    this.status = status;
    this.kind = kind;
    this.rowCount = rowCount;
    this.rollupComputedAt = rollupComputedAt;
    this.downloadUrl = downloadUrl;
    this.error = error;
    this.createdAt = createdAt;
    this.completedAt = completedAt;
  }

  public ExportResponseDto id(String id) {
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

  public ExportResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
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

  public ExportResponseDto kind(KindEnum kind) {
    this.kind = kind;
    return this;
  }

  /**
   * Get kind
   * @return kind
   */
  
  @JsonProperty("kind")
  public KindEnum getKind() {
    return kind;
  }

  @JsonProperty("kind")
  public void setKind(KindEnum kind) {
    this.kind = kind;
  }

  public ExportResponseDto rowCount(BigDecimal rowCount) {
    this.rowCount = rowCount;
    return this;
  }

  /**
   * Get rowCount
   * @return rowCount
   */
  @Valid 
  @JsonProperty("rowCount")
  public BigDecimal getRowCount() {
    return rowCount;
  }

  @JsonProperty("rowCount")
  public void setRowCount(BigDecimal rowCount) {
    this.rowCount = rowCount;
  }

  public ExportResponseDto rollupComputedAt(OffsetDateTime rollupComputedAt) {
    this.rollupComputedAt = rollupComputedAt;
    return this;
  }

  /**
   * The newest rollup run behind the file — the disputed-number guard.  Two people exporting \"last quarter\" a week apart can see whether the data was recomputed between them rather than guessing.
   * @return rollupComputedAt
   */
  @Valid 
  @JsonProperty("rollupComputedAt")
  public OffsetDateTime getRollupComputedAt() {
    return rollupComputedAt;
  }

  @JsonProperty("rollupComputedAt")
  public void setRollupComputedAt(OffsetDateTime rollupComputedAt) {
    this.rollupComputedAt = rollupComputedAt;
  }

  public ExportResponseDto downloadUrl(String downloadUrl) {
    this.downloadUrl = downloadUrl;
    return this;
  }

  /**
   * Present only while READY, and minted per request.  A signed URL to a tenant's full ticket history is a credential, so it is never stored — which is also why polling twice yields two different URLs.
   * @return downloadUrl
   */
  
  @JsonProperty("downloadUrl")
  public String getDownloadUrl() {
    return downloadUrl;
  }

  @JsonProperty("downloadUrl")
  public void setDownloadUrl(String downloadUrl) {
    this.downloadUrl = downloadUrl;
  }

  public ExportResponseDto error(String error) {
    this.error = error;
    return this;
  }

  /**
   * Get error
   * @return error
   */
  
  @JsonProperty("error")
  public String getError() {
    return error;
  }

  @JsonProperty("error")
  public void setError(String error) {
    this.error = error;
  }

  public ExportResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull @Valid 
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public ExportResponseDto completedAt(OffsetDateTime completedAt) {
    this.completedAt = completedAt;
    return this;
  }

  /**
   * Get completedAt
   * @return completedAt
   */
  @Valid 
  @JsonProperty("completedAt")
  public OffsetDateTime getCompletedAt() {
    return completedAt;
  }

  @JsonProperty("completedAt")
  public void setCompletedAt(OffsetDateTime completedAt) {
    this.completedAt = completedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ExportResponseDto exportResponseDto = (ExportResponseDto) o;
    return Objects.equals(this.id, exportResponseDto.id) &&
        Objects.equals(this.status, exportResponseDto.status) &&
        Objects.equals(this.kind, exportResponseDto.kind) &&
        Objects.equals(this.rowCount, exportResponseDto.rowCount) &&
        Objects.equals(this.rollupComputedAt, exportResponseDto.rollupComputedAt) &&
        Objects.equals(this.downloadUrl, exportResponseDto.downloadUrl) &&
        Objects.equals(this.error, exportResponseDto.error) &&
        Objects.equals(this.createdAt, exportResponseDto.createdAt) &&
        Objects.equals(this.completedAt, exportResponseDto.completedAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, status, kind, rowCount, rollupComputedAt, downloadUrl, error, createdAt, completedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ExportResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    kind: ").append(toIndentedString(kind)).append("\n");
    sb.append("    rowCount: ").append(toIndentedString(rowCount)).append("\n");
    sb.append("    rollupComputedAt: ").append(toIndentedString(rollupComputedAt)).append("\n");
    sb.append("    downloadUrl: ").append(toIndentedString(downloadUrl)).append("\n");
    sb.append("    error: ").append(toIndentedString(error)).append("\n");
    sb.append("    createdAt: ").append(toIndentedString(createdAt)).append("\n");
    sb.append("    completedAt: ").append(toIndentedString(completedAt)).append("\n");
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


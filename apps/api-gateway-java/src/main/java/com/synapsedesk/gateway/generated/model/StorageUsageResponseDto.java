package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * StorageUsageResponseDto
 */

public class StorageUsageResponseDto {

  private BigDecimal usedBytes;

  private BigDecimal limitBytes;

  private BigDecimal documentCount;

  public StorageUsageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public StorageUsageResponseDto(BigDecimal usedBytes, BigDecimal limitBytes, BigDecimal documentCount) {
    this.usedBytes = usedBytes;
    this.limitBytes = limitBytes;
    this.documentCount = documentCount;
  }

  public StorageUsageResponseDto usedBytes(BigDecimal usedBytes) {
    this.usedBytes = usedBytes;
    return this;
  }

  /**
   * Get usedBytes
   * @return usedBytes
   */
  @NotNull @Valid 
  @JsonProperty("usedBytes")
  public BigDecimal getUsedBytes() {
    return usedBytes;
  }

  @JsonProperty("usedBytes")
  public void setUsedBytes(BigDecimal usedBytes) {
    this.usedBytes = usedBytes;
  }

  public StorageUsageResponseDto limitBytes(BigDecimal limitBytes) {
    this.limitBytes = limitBytes;
    return this;
  }

  /**
   * Get limitBytes
   * @return limitBytes
   */
  @NotNull @Valid 
  @JsonProperty("limitBytes")
  public BigDecimal getLimitBytes() {
    return limitBytes;
  }

  @JsonProperty("limitBytes")
  public void setLimitBytes(BigDecimal limitBytes) {
    this.limitBytes = limitBytes;
  }

  public StorageUsageResponseDto documentCount(BigDecimal documentCount) {
    this.documentCount = documentCount;
    return this;
  }

  /**
   * Get documentCount
   * @return documentCount
   */
  @NotNull @Valid 
  @JsonProperty("documentCount")
  public BigDecimal getDocumentCount() {
    return documentCount;
  }

  @JsonProperty("documentCount")
  public void setDocumentCount(BigDecimal documentCount) {
    this.documentCount = documentCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    StorageUsageResponseDto storageUsageResponseDto = (StorageUsageResponseDto) o;
    return Objects.equals(this.usedBytes, storageUsageResponseDto.usedBytes) &&
        Objects.equals(this.limitBytes, storageUsageResponseDto.limitBytes) &&
        Objects.equals(this.documentCount, storageUsageResponseDto.documentCount);
  }

  @Override
  public int hashCode() {
    return Objects.hash(usedBytes, limitBytes, documentCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class StorageUsageResponseDto {\n");
    sb.append("    usedBytes: ").append(toIndentedString(usedBytes)).append("\n");
    sb.append("    limitBytes: ").append(toIndentedString(limitBytes)).append("\n");
    sb.append("    documentCount: ").append(toIndentedString(documentCount)).append("\n");
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


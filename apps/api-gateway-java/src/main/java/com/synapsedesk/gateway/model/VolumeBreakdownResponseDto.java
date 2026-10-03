package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * VolumeBreakdownResponseDto
 */

public class VolumeBreakdownResponseDto {

  private String key;

  private BigDecimal count;

  public VolumeBreakdownResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public VolumeBreakdownResponseDto(String key, BigDecimal count) {
    this.key = key;
    this.count = count;
  }

  public VolumeBreakdownResponseDto key(String key) {
    this.key = key;
    return this;
  }

  /**
   * Get key
   * @return key
   */
  @NotNull
  @JsonProperty("key")
  public String getKey() {
    return key;
  }

  @JsonProperty("key")
  public void setKey(String key) {
    this.key = key;
  }

  public VolumeBreakdownResponseDto count(BigDecimal count) {
    this.count = count;
    return this;
  }

  /**
   * Get count
   * @return count
   */
  @NotNull
  @Valid
  @JsonProperty("count")
  public BigDecimal getCount() {
    return count;
  }

  @JsonProperty("count")
  public void setCount(BigDecimal count) {
    this.count = count;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    VolumeBreakdownResponseDto volumeBreakdownResponseDto =
      (VolumeBreakdownResponseDto) o;
    return (
      Objects.equals(this.key, volumeBreakdownResponseDto.key) &&
      Objects.equals(this.count, volumeBreakdownResponseDto.count)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(key, count);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class VolumeBreakdownResponseDto {\n");
    sb.append("    key: ").append(toIndentedString(key)).append("\n");
    sb.append("    count: ").append(toIndentedString(count)).append("\n");
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

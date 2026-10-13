package com.synapsedesk.gateway.modules.analytics.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * MeanResponseDto
 */

public class MeanResponseDto {

  private BigDecimal mean = null;

  private BigDecimal count;

  public MeanResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public MeanResponseDto(BigDecimal mean, BigDecimal count) {
    this.mean = mean;
    this.count = count;
  }

  public MeanResponseDto mean(BigDecimal mean) {
    this.mean = mean;
    return this;
  }

  /**
   * Get mean
   * @return mean
   */
  @Valid
  @JsonProperty("mean")
  public BigDecimal getMean() {
    return mean;
  }

  @JsonProperty("mean")
  public void setMean(BigDecimal mean) {
    this.mean = mean;
  }

  public MeanResponseDto count(BigDecimal count) {
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
    MeanResponseDto meanResponseDto = (MeanResponseDto) o;
    return (
      Objects.equals(this.mean, meanResponseDto.mean) &&
      Objects.equals(this.count, meanResponseDto.count)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(mean, count);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MeanResponseDto {\n");
    sb.append("    mean: ").append(toIndentedString(mean)).append("\n");
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

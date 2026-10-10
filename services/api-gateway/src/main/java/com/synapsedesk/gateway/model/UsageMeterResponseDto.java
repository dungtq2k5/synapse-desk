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
 * UsageMeterResponseDto
 */

public class UsageMeterResponseDto {

  private Boolean available;

  private BigDecimal used = null;

  private BigDecimal limit = null;

  private String unavailableReason = null;

  public UsageMeterResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UsageMeterResponseDto(
    Boolean available,
    BigDecimal used,
    BigDecimal limit,
    String unavailableReason
  ) {
    this.available = available;
    this.used = used;
    this.limit = limit;
    this.unavailableReason = unavailableReason;
  }

  public UsageMeterResponseDto available(Boolean available) {
    this.available = available;
    return this;
  }

  /**
   * Get available
   * @return available
   */
  @NotNull
  @JsonProperty("available")
  public Boolean getAvailable() {
    return available;
  }

  @JsonProperty("available")
  public void setAvailable(Boolean available) {
    this.available = available;
  }

  public UsageMeterResponseDto used(BigDecimal used) {
    this.used = used;
    return this;
  }

  /**
   * Get used
   * @return used
   */
  @Valid
  @JsonProperty("used")
  public BigDecimal getUsed() {
    return used;
  }

  @JsonProperty("used")
  public void setUsed(BigDecimal used) {
    this.used = used;
  }

  public UsageMeterResponseDto limit(BigDecimal limit) {
    this.limit = limit;
    return this;
  }

  /**
   * Get limit
   * @return limit
   */
  @Valid
  @JsonProperty("limit")
  public BigDecimal getLimit() {
    return limit;
  }

  @JsonProperty("limit")
  public void setLimit(BigDecimal limit) {
    this.limit = limit;
  }

  public UsageMeterResponseDto unavailableReason(String unavailableReason) {
    this.unavailableReason = unavailableReason;
    return this;
  }

  /**
   * Get unavailableReason
   * @return unavailableReason
   */

  @JsonProperty("unavailableReason")
  public String getUnavailableReason() {
    return unavailableReason;
  }

  @JsonProperty("unavailableReason")
  public void setUnavailableReason(String unavailableReason) {
    this.unavailableReason = unavailableReason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UsageMeterResponseDto usageMeterResponseDto = (UsageMeterResponseDto) o;
    return (
      Objects.equals(this.available, usageMeterResponseDto.available) &&
      Objects.equals(this.used, usageMeterResponseDto.used) &&
      Objects.equals(this.limit, usageMeterResponseDto.limit) &&
      Objects.equals(
        this.unavailableReason,
        usageMeterResponseDto.unavailableReason
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(available, used, limit, unavailableReason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UsageMeterResponseDto {\n");
    sb.append("    available: ")
      .append(toIndentedString(available))
      .append("\n");
    sb.append("    used: ").append(toIndentedString(used)).append("\n");
    sb.append("    limit: ").append(toIndentedString(limit)).append("\n");
    sb.append("    unavailableReason: ")
      .append(toIndentedString(unavailableReason))
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

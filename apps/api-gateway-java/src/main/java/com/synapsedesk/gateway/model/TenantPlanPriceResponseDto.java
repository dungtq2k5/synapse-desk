package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * TenantPlanPriceResponseDto
 */

public class TenantPlanPriceResponseDto {

  private String stripePriceId;

  private String interval;

  public TenantPlanPriceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TenantPlanPriceResponseDto(String stripePriceId, String interval) {
    this.stripePriceId = stripePriceId;
    this.interval = interval;
  }

  public TenantPlanPriceResponseDto stripePriceId(String stripePriceId) {
    this.stripePriceId = stripePriceId;
    return this;
  }

  /**
   * Get stripePriceId
   * @return stripePriceId
   */
  @NotNull
  @JsonProperty("stripePriceId")
  public String getStripePriceId() {
    return stripePriceId;
  }

  @JsonProperty("stripePriceId")
  public void setStripePriceId(String stripePriceId) {
    this.stripePriceId = stripePriceId;
  }

  public TenantPlanPriceResponseDto interval(String interval) {
    this.interval = interval;
    return this;
  }

  /**
   * Stripe's literal — `month` | `year` in practice, and wider in theory.
   * @return interval
   */
  @NotNull
  @JsonProperty("interval")
  public String getInterval() {
    return interval;
  }

  @JsonProperty("interval")
  public void setInterval(String interval) {
    this.interval = interval;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TenantPlanPriceResponseDto tenantPlanPriceResponseDto =
      (TenantPlanPriceResponseDto) o;
    return (
      Objects.equals(
        this.stripePriceId,
        tenantPlanPriceResponseDto.stripePriceId
      ) && Objects.equals(this.interval, tenantPlanPriceResponseDto.interval)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(stripePriceId, interval);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TenantPlanPriceResponseDto {\n");
    sb.append("    stripePriceId: ")
      .append(toIndentedString(stripePriceId))
      .append("\n");
    sb.append("    interval: ").append(toIndentedString(interval)).append("\n");
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

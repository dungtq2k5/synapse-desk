package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * ResetBillingCycleDto
 */

public class ResetBillingCycleDto {

  private String reason;

  public ResetBillingCycleDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ResetBillingCycleDto(String reason) {
    this.reason = reason;
  }

  public ResetBillingCycleDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */
  @NotNull
  @Size(min = 1, max = 500)
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ResetBillingCycleDto resetBillingCycleDto = (ResetBillingCycleDto) o;
    return Objects.equals(this.reason, resetBillingCycleDto.reason);
  }

  @Override
  public int hashCode() {
    return Objects.hash(reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ResetBillingCycleDto {\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
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

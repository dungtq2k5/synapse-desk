package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * PlanChangeResponseDto
 */

public class PlanChangeResponseDto {

  private String planId;

  private String planName;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime effectiveAt = null;

  private Boolean creditIssued = null;

  public PlanChangeResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlanChangeResponseDto(
    String planId,
    String planName,
    OffsetDateTime effectiveAt,
    Boolean creditIssued
  ) {
    this.planId = planId;
    this.planName = planName;
    this.effectiveAt = effectiveAt;
    this.creditIssued = creditIssued;
  }

  public PlanChangeResponseDto planId(String planId) {
    this.planId = planId;
    return this;
  }

  /**
   * Get planId
   * @return planId
   */
  @NotNull
  @JsonProperty("planId")
  public String getPlanId() {
    return planId;
  }

  @JsonProperty("planId")
  public void setPlanId(String planId) {
    this.planId = planId;
  }

  public PlanChangeResponseDto planName(String planName) {
    this.planName = planName;
    return this;
  }

  /**
   * Get planName
   * @return planName
   */
  @NotNull
  @JsonProperty("planName")
  public String getPlanName() {
    return planName;
  }

  @JsonProperty("planName")
  public void setPlanName(String planName) {
    this.planName = planName;
  }

  public PlanChangeResponseDto effectiveAt(OffsetDateTime effectiveAt) {
    this.effectiveAt = effectiveAt;
    return this;
  }

  /**
   * Get effectiveAt
   * @return effectiveAt
   */
  @Valid
  @JsonProperty("effectiveAt")
  public OffsetDateTime getEffectiveAt() {
    return effectiveAt;
  }

  @JsonProperty("effectiveAt")
  public void setEffectiveAt(OffsetDateTime effectiveAt) {
    this.effectiveAt = effectiveAt;
  }

  public PlanChangeResponseDto creditIssued(Boolean creditIssued) {
    this.creditIssued = creditIssued;
    return this;
  }

  /**
   * Whether the proration credited rather than charged — **`null` when it could not be determined.**  A downgrade produces a credit against future invoices, never a refund, and a client that does not say so is a support ticket. Three-valued on purpose: `always_invoice` does not guarantee the proration lands on the invoice this is read from, so a `false` can be wrong for a change that credited and a `true` can be read off an unrelated invoice. `null` means *say nothing* — which is the honest option, and the one a comment on a plain `boolean` cannot give a UI that is already rendering it.
   * @return creditIssued
   */

  @JsonProperty("creditIssued")
  public Boolean getCreditIssued() {
    return creditIssued;
  }

  @JsonProperty("creditIssued")
  public void setCreditIssued(Boolean creditIssued) {
    this.creditIssued = creditIssued;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlanChangeResponseDto planChangeResponseDto = (PlanChangeResponseDto) o;
    return (
      Objects.equals(this.planId, planChangeResponseDto.planId) &&
      Objects.equals(this.planName, planChangeResponseDto.planName) &&
      Objects.equals(this.effectiveAt, planChangeResponseDto.effectiveAt) &&
      Objects.equals(this.creditIssued, planChangeResponseDto.creditIssued)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(planId, planName, effectiveAt, creditIssued);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlanChangeResponseDto {\n");
    sb.append("    planId: ").append(toIndentedString(planId)).append("\n");
    sb.append("    planName: ").append(toIndentedString(planName)).append("\n");
    sb.append("    effectiveAt: ")
      .append(toIndentedString(effectiveAt))
      .append("\n");
    sb.append("    creditIssued: ")
      .append(toIndentedString(creditIssued))
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

package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * FinancePlanMixResponseDto
 */

public class FinancePlanMixResponseDto {

  private String planId;

  private String planName;

  private BigDecimal subscribers;

  private BigDecimal seatsAllocated;

  public FinancePlanMixResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FinancePlanMixResponseDto(
    String planId,
    String planName,
    BigDecimal subscribers,
    BigDecimal seatsAllocated
  ) {
    this.planId = planId;
    this.planName = planName;
    this.subscribers = subscribers;
    this.seatsAllocated = seatsAllocated;
  }

  public FinancePlanMixResponseDto planId(String planId) {
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

  public FinancePlanMixResponseDto planName(String planName) {
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

  public FinancePlanMixResponseDto subscribers(BigDecimal subscribers) {
    this.subscribers = subscribers;
    return this;
  }

  /**
   * Live subscribers — **not** `SubscriptionPlanResponseDto.subscriberCount`.  That one is unfiltered and counts soft-deleted tenants, because `DELETE /platform/plans/:id` reads it to refuse retiring a plan somebody still points at and an offboarded tenant can be restored. This one excludes them, because an offboarded tenant is not a subscriber and the same response's `tenants.total` excludes them too.
   * @return subscribers
   */
  @NotNull
  @Valid
  @JsonProperty("subscribers")
  public BigDecimal getSubscribers() {
    return subscribers;
  }

  @JsonProperty("subscribers")
  public void setSubscribers(BigDecimal subscribers) {
    this.subscribers = subscribers;
  }

  public FinancePlanMixResponseDto seatsAllocated(BigDecimal seatsAllocated) {
    this.seatsAllocated = seatsAllocated;
    return this;
  }

  /**
   * Summed from what tenants HOLD, so pinned and overridden grants count.
   * @return seatsAllocated
   */
  @NotNull
  @Valid
  @JsonProperty("seatsAllocated")
  public BigDecimal getSeatsAllocated() {
    return seatsAllocated;
  }

  @JsonProperty("seatsAllocated")
  public void setSeatsAllocated(BigDecimal seatsAllocated) {
    this.seatsAllocated = seatsAllocated;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FinancePlanMixResponseDto financePlanMixResponseDto =
      (FinancePlanMixResponseDto) o;
    return (
      Objects.equals(this.planId, financePlanMixResponseDto.planId) &&
      Objects.equals(this.planName, financePlanMixResponseDto.planName) &&
      Objects.equals(this.subscribers, financePlanMixResponseDto.subscribers) &&
      Objects.equals(
        this.seatsAllocated,
        financePlanMixResponseDto.seatsAllocated
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(planId, planName, subscribers, seatsAllocated);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FinancePlanMixResponseDto {\n");
    sb.append("    planId: ").append(toIndentedString(planId)).append("\n");
    sb.append("    planName: ").append(toIndentedString(planName)).append("\n");
    sb.append("    subscribers: ")
      .append(toIndentedString(subscribers))
      .append("\n");
    sb.append("    seatsAllocated: ")
      .append(toIndentedString(seatsAllocated))
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

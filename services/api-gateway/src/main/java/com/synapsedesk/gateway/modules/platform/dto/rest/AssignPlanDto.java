package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Put an organization on a negotiated plan: one with no Stripe product, not
 * Free. Its grants become the plan's, so applying the plan reaches it.
 */

public class AssignPlanDto {

  private UUID planId;

  private @Nullable String reason;

  public AssignPlanDto planId(UUID planId) {
    this.planId = planId;
    return this;
  }

  /**
   * Get planId
   * @return planId
   */
  @NotNull
  @JsonProperty("planId")
  public UUID getPlanId() {
    return planId;
  }

  @JsonProperty("planId")
  public void setPlanId(UUID planId) {
    this.planId = planId;
  }

  public AssignPlanDto reason(@Nullable String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */
  @Size(max = 500)
  @JsonProperty("reason")
  public @Nullable String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(@Nullable String reason) {
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
    AssignPlanDto assignPlanDto = (AssignPlanDto) o;
    return (
      Objects.equals(this.planId, assignPlanDto.planId) &&
      Objects.equals(this.reason, assignPlanDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(planId, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AssignPlanDto {\n");
    sb.append("    planId: ").append(toIndentedString(planId)).append("\n");
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

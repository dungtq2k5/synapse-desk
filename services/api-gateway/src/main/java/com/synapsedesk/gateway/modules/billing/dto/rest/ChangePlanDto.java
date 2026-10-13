package com.synapsedesk.gateway.modules.billing.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * ChangePlanDto
 */

public class ChangePlanDto {

  private UUID planId;

  private String priceId;

  public ChangePlanDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ChangePlanDto(UUID planId, String priceId) {
    this.planId = planId;
    this.priceId = priceId;
  }

  public ChangePlanDto planId(UUID planId) {
    this.planId = planId;
    return this;
  }

  /**
   * Get planId
   * @return planId
   */
  @NotNull
  @Valid
  @JsonProperty("planId")
  public UUID getPlanId() {
    return planId;
  }

  @JsonProperty("planId")
  public void setPlanId(UUID planId) {
    this.planId = planId;
  }

  public ChangePlanDto priceId(String priceId) {
    this.priceId = priceId;
    return this;
  }

  /**
   * Both ids, and they must agree.  Sending only the price would let a caller name Pro's plan and Starter's price; sending only the plan would charge them for a price the plan does not own. The endpoint refuses a mismatch rather than picking one.
   * @return priceId
   */
  @NotNull
  @Size(min = 1, max = 255)
  @JsonProperty("priceId")
  public String getPriceId() {
    return priceId;
  }

  @JsonProperty("priceId")
  public void setPriceId(String priceId) {
    this.priceId = priceId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ChangePlanDto changePlanDto = (ChangePlanDto) o;
    return (
      Objects.equals(this.planId, changePlanDto.planId) &&
      Objects.equals(this.priceId, changePlanDto.priceId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(planId, priceId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ChangePlanDto {\n");
    sb.append("    planId: ").append(toIndentedString(planId)).append("\n");
    sb.append("    priceId: ").append(toIndentedString(priceId)).append("\n");
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

package com.synapsedesk.gateway.modules.platform.dto.rest;

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
 * SubscriptionPlanPriceResponseDto
 */

public class SubscriptionPlanPriceResponseDto {

  private String id;

  private String stripePriceId;

  private String interval;

  public SubscriptionPlanPriceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SubscriptionPlanPriceResponseDto(
    String id,
    String stripePriceId,
    String interval
  ) {
    this.id = id;
    this.stripePriceId = stripePriceId;
    this.interval = interval;
  }

  public SubscriptionPlanPriceResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public SubscriptionPlanPriceResponseDto stripePriceId(String stripePriceId) {
    this.stripePriceId = stripePriceId;
    return this;
  }

  /**
   * Stripe's id. `month` and `year` on one plan are the reason this is a list.
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

  public SubscriptionPlanPriceResponseDto interval(String interval) {
    this.interval = interval;
    return this;
  }

  /**
   * The billing period this price charges for — `month` or `year` in practice.  Not narrowed to those two: the value is whatever Stripe sent, and Stripe's own vocabulary includes `day` and `week`.
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
    SubscriptionPlanPriceResponseDto subscriptionPlanPriceResponseDto =
      (SubscriptionPlanPriceResponseDto) o;
    return (
      Objects.equals(this.id, subscriptionPlanPriceResponseDto.id) &&
      Objects.equals(
        this.stripePriceId,
        subscriptionPlanPriceResponseDto.stripePriceId
      ) &&
      Objects.equals(this.interval, subscriptionPlanPriceResponseDto.interval)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, stripePriceId, interval);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SubscriptionPlanPriceResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
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

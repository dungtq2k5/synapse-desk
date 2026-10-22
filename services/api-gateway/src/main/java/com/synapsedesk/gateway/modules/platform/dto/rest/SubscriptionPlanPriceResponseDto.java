package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SubscriptionPlanPriceResponseDto
 */

public class SubscriptionPlanPriceResponseDto {

  private String id;

  private String stripePriceId;

  private String interval;

  private BigDecimal unitAmount = null;

  private String currency = null;

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

  public SubscriptionPlanPriceResponseDto unitAmount(BigDecimal unitAmount) {
    this.unitAmount = unitAmount;
    return this;
  }

  /**
   * Get unitAmount
   * @return unitAmount
   */
  @JsonProperty("unitAmount")
  public BigDecimal getUnitAmount() {
    return unitAmount;
  }

  @JsonProperty("unitAmount")
  public void setUnitAmount(BigDecimal unitAmount) {
    this.unitAmount = unitAmount;
  }

  public SubscriptionPlanPriceResponseDto currency(String currency) {
    this.currency = currency;
    return this;
  }

  /**
   * Get currency
   * @return currency
   */
  @JsonProperty("currency")
  public String getCurrency() {
    return currency;
  }

  @JsonProperty("currency")
  public void setCurrency(String currency) {
    this.currency = currency;
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
      Objects.equals(
        this.interval,
        subscriptionPlanPriceResponseDto.interval
      ) &&
      Objects.equals(
        this.unitAmount,
        subscriptionPlanPriceResponseDto.unitAmount
      ) &&
      Objects.equals(this.currency, subscriptionPlanPriceResponseDto.currency)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, stripePriceId, interval, unitAmount, currency);
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
    sb.append("    unitAmount: ")
      .append(toIndentedString(unitAmount))
      .append("\n");
    sb.append("    currency: ").append(toIndentedString(currency)).append("\n");
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

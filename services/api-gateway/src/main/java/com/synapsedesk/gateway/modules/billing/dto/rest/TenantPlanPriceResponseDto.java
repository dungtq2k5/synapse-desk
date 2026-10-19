package com.synapsedesk.gateway.modules.billing.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * TenantPlanPriceResponseDto
 */

public class TenantPlanPriceResponseDto {

  private String stripePriceId;

  private String interval;

  private BigDecimal unitAmount = null;

  private String currency = null;

  public TenantPlanPriceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TenantPlanPriceResponseDto(
    String stripePriceId,
    String interval,
    BigDecimal unitAmount,
    String currency
  ) {
    this.stripePriceId = stripePriceId;
    this.interval = interval;
    this.unitAmount = unitAmount;
    this.currency = currency;
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

  public TenantPlanPriceResponseDto unitAmount(BigDecimal unitAmount) {
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

  public TenantPlanPriceResponseDto currency(String currency) {
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
    TenantPlanPriceResponseDto tenantPlanPriceResponseDto =
      (TenantPlanPriceResponseDto) o;
    return (
      Objects.equals(
        this.stripePriceId,
        tenantPlanPriceResponseDto.stripePriceId
      ) &&
      Objects.equals(this.interval, tenantPlanPriceResponseDto.interval) &&
      Objects.equals(this.unitAmount, tenantPlanPriceResponseDto.unitAmount) &&
      Objects.equals(this.currency, tenantPlanPriceResponseDto.currency)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(stripePriceId, interval, unitAmount, currency);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TenantPlanPriceResponseDto {\n");
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

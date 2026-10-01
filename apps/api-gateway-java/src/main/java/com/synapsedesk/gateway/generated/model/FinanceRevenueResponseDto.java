package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * FinanceRevenueResponseDto
 */

public class FinanceRevenueResponseDto {

  private Boolean available;

  private String unavailableReason = null;

  private BigDecimal estimatedMrr = null;

  private String currency = null;

  private BigDecimal activeSubscriptions = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime computedAt = null;

  private List<String> excludes = new ArrayList<>();

  public FinanceRevenueResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FinanceRevenueResponseDto(Boolean available, String unavailableReason, BigDecimal estimatedMrr, String currency, BigDecimal activeSubscriptions, OffsetDateTime computedAt, List<String> excludes) {
    this.available = available;
    this.unavailableReason = unavailableReason;
    this.estimatedMrr = estimatedMrr;
    this.currency = currency;
    this.activeSubscriptions = activeSubscriptions;
    this.computedAt = computedAt;
    this.excludes = excludes;
  }

  public FinanceRevenueResponseDto available(Boolean available) {
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

  public FinanceRevenueResponseDto unavailableReason(String unavailableReason) {
    this.unavailableReason = unavailableReason;
    return this;
  }

  /**
   * Present exactly when `available` is false.
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

  public FinanceRevenueResponseDto estimatedMrr(BigDecimal estimatedMrr) {
    this.estimatedMrr = estimatedMrr;
    return this;
  }

  /**
   * Smallest currency unit. Annual prices divided by twelve.
   * @return estimatedMrr
   */
  @Valid 
  @JsonProperty("estimatedMrr")
  public BigDecimal getEstimatedMrr() {
    return estimatedMrr;
  }

  @JsonProperty("estimatedMrr")
  public void setEstimatedMrr(BigDecimal estimatedMrr) {
    this.estimatedMrr = estimatedMrr;
  }

  public FinanceRevenueResponseDto currency(String currency) {
    this.currency = currency;
    return this;
  }

  /**
   * NULL when there are no active subscriptions to take one from.
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

  public FinanceRevenueResponseDto activeSubscriptions(BigDecimal activeSubscriptions) {
    this.activeSubscriptions = activeSubscriptions;
    return this;
  }

  /**
   * Get activeSubscriptions
   * @return activeSubscriptions
   */
  @Valid 
  @JsonProperty("activeSubscriptions")
  public BigDecimal getActiveSubscriptions() {
    return activeSubscriptions;
  }

  @JsonProperty("activeSubscriptions")
  public void setActiveSubscriptions(BigDecimal activeSubscriptions) {
    this.activeSubscriptions = activeSubscriptions;
  }

  public FinanceRevenueResponseDto computedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
    return this;
  }

  /**
   * When the JOB read Stripe — never when this endpoint answered.
   * @return computedAt
   */
  @Valid 
  @JsonProperty("computedAt")
  public OffsetDateTime getComputedAt() {
    return computedAt;
  }

  @JsonProperty("computedAt")
  public void setComputedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
  }

  public FinanceRevenueResponseDto excludes(List<String> excludes) {
    this.excludes = excludes;
    return this;
  }

  public FinanceRevenueResponseDto addExcludesItem(String excludesItem) {
    if (this.excludes == null) {
      this.excludes = new ArrayList<>();
    }
    this.excludes.add(excludesItem);
    return this;
  }

  /**
   * The caveats, traveling with the number.  On the wire deliberately: a field called `mrr` gets quoted in a meeting, and a caveat that lives in a document nobody opens beside the chart is not a caveat. Present on every response, including the ones with no number.
   * @return excludes
   */
  @NotNull 
  @JsonProperty("excludes")
  public List<String> getExcludes() {
    return excludes;
  }

  @JsonProperty("excludes")
  public void setExcludes(List<String> excludes) {
    this.excludes = excludes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FinanceRevenueResponseDto financeRevenueResponseDto = (FinanceRevenueResponseDto) o;
    return Objects.equals(this.available, financeRevenueResponseDto.available) &&
        Objects.equals(this.unavailableReason, financeRevenueResponseDto.unavailableReason) &&
        Objects.equals(this.estimatedMrr, financeRevenueResponseDto.estimatedMrr) &&
        Objects.equals(this.currency, financeRevenueResponseDto.currency) &&
        Objects.equals(this.activeSubscriptions, financeRevenueResponseDto.activeSubscriptions) &&
        Objects.equals(this.computedAt, financeRevenueResponseDto.computedAt) &&
        Objects.equals(this.excludes, financeRevenueResponseDto.excludes);
  }

  @Override
  public int hashCode() {
    return Objects.hash(available, unavailableReason, estimatedMrr, currency, activeSubscriptions, computedAt, excludes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FinanceRevenueResponseDto {\n");
    sb.append("    available: ").append(toIndentedString(available)).append("\n");
    sb.append("    unavailableReason: ").append(toIndentedString(unavailableReason)).append("\n");
    sb.append("    estimatedMrr: ").append(toIndentedString(estimatedMrr)).append("\n");
    sb.append("    currency: ").append(toIndentedString(currency)).append("\n");
    sb.append("    activeSubscriptions: ").append(toIndentedString(activeSubscriptions)).append("\n");
    sb.append("    computedAt: ").append(toIndentedString(computedAt)).append("\n");
    sb.append("    excludes: ").append(toIndentedString(excludes)).append("\n");
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


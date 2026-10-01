package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * FinanceTenantCountsResponseDto
 */

public class FinanceTenantCountsResponseDto {

  private BigDecimal total;

  private Map<String, BigDecimal> byStatus = new HashMap<>();

  public FinanceTenantCountsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FinanceTenantCountsResponseDto(BigDecimal total, Map<String, BigDecimal> byStatus) {
    this.total = total;
    this.byStatus = byStatus;
  }

  public FinanceTenantCountsResponseDto total(BigDecimal total) {
    this.total = total;
    return this;
  }

  /**
   * Get total
   * @return total
   */
  @NotNull @Valid 
  @JsonProperty("total")
  public BigDecimal getTotal() {
    return total;
  }

  @JsonProperty("total")
  public void setTotal(BigDecimal total) {
    this.total = total;
  }

  public FinanceTenantCountsResponseDto byStatus(Map<String, BigDecimal> byStatus) {
    this.byStatus = byStatus;
    return this;
  }

  public FinanceTenantCountsResponseDto putByStatusItem(String key, BigDecimal byStatusItem) {
    if (this.byStatus == null) {
      this.byStatus = new HashMap<>();
    }
    this.byStatus.put(key, byStatusItem);
    return this;
  }

  /**
   * Keyed by status, so a new status needs no new field.  **`ACTIVE` here is not `activeSubscriptions` below.** The Stripe status mapping folds `trialing` into `ACTIVE`, and the revenue estimate counts `status: 'active'` subscriptions only. Two populations, one adjective — subtracting one from the other produces a number that means nothing.
   * @return byStatus
   */
  @NotNull @Valid 
  @JsonProperty("byStatus")
  public Map<String, BigDecimal> getByStatus() {
    return byStatus;
  }

  @JsonProperty("byStatus")
  public void setByStatus(Map<String, BigDecimal> byStatus) {
    this.byStatus = byStatus;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FinanceTenantCountsResponseDto financeTenantCountsResponseDto = (FinanceTenantCountsResponseDto) o;
    return Objects.equals(this.total, financeTenantCountsResponseDto.total) &&
        Objects.equals(this.byStatus, financeTenantCountsResponseDto.byStatus);
  }

  @Override
  public int hashCode() {
    return Objects.hash(total, byStatus);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FinanceTenantCountsResponseDto {\n");
    sb.append("    total: ").append(toIndentedString(total)).append("\n");
    sb.append("    byStatus: ").append(toIndentedString(byStatus)).append("\n");
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


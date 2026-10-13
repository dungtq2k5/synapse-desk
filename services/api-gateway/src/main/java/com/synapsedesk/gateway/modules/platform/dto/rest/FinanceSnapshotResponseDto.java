package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * FinanceSnapshotResponseDto
 */

public class FinanceSnapshotResponseDto {

  private FinanceTenantCountsResponseDto tenants;

  private List<@Valid FinancePlanMixResponseDto> plans = new ArrayList<>();

  private FinanceDunningResponseDto dunning;

  private FinanceRevenueResponseDto revenue;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime generatedAt;

  public FinanceSnapshotResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FinanceSnapshotResponseDto(
    FinanceTenantCountsResponseDto tenants,
    List<@Valid FinancePlanMixResponseDto> plans,
    FinanceDunningResponseDto dunning,
    FinanceRevenueResponseDto revenue,
    OffsetDateTime generatedAt
  ) {
    this.tenants = tenants;
    this.plans = plans;
    this.dunning = dunning;
    this.revenue = revenue;
    this.generatedAt = generatedAt;
  }

  public FinanceSnapshotResponseDto tenants(
    FinanceTenantCountsResponseDto tenants
  ) {
    this.tenants = tenants;
    return this;
  }

  /**
   * Get tenants
   * @return tenants
   */
  @NotNull
  @Valid
  @JsonProperty("tenants")
  public FinanceTenantCountsResponseDto getTenants() {
    return tenants;
  }

  @JsonProperty("tenants")
  public void setTenants(FinanceTenantCountsResponseDto tenants) {
    this.tenants = tenants;
  }

  public FinanceSnapshotResponseDto plans(
    List<@Valid FinancePlanMixResponseDto> plans
  ) {
    this.plans = plans;
    return this;
  }

  public FinanceSnapshotResponseDto addPlansItem(
    FinancePlanMixResponseDto plansItem
  ) {
    if (this.plans == null) {
      this.plans = new ArrayList<>();
    }
    this.plans.add(plansItem);
    return this;
  }

  /**
   * Get plans
   * @return plans
   */
  @NotNull
  @Valid
  @JsonProperty("plans")
  public List<@Valid FinancePlanMixResponseDto> getPlans() {
    return plans;
  }

  @JsonProperty("plans")
  public void setPlans(List<@Valid FinancePlanMixResponseDto> plans) {
    this.plans = plans;
  }

  public FinanceSnapshotResponseDto dunning(FinanceDunningResponseDto dunning) {
    this.dunning = dunning;
    return this;
  }

  /**
   * Get dunning
   * @return dunning
   */
  @NotNull
  @Valid
  @JsonProperty("dunning")
  public FinanceDunningResponseDto getDunning() {
    return dunning;
  }

  @JsonProperty("dunning")
  public void setDunning(FinanceDunningResponseDto dunning) {
    this.dunning = dunning;
  }

  public FinanceSnapshotResponseDto revenue(FinanceRevenueResponseDto revenue) {
    this.revenue = revenue;
    return this;
  }

  /**
   * Get revenue
   * @return revenue
   */
  @NotNull
  @Valid
  @JsonProperty("revenue")
  public FinanceRevenueResponseDto getRevenue() {
    return revenue;
  }

  @JsonProperty("revenue")
  public void setRevenue(FinanceRevenueResponseDto revenue) {
    this.revenue = revenue;
  }

  public FinanceSnapshotResponseDto generatedAt(OffsetDateTime generatedAt) {
    this.generatedAt = generatedAt;
    return this;
  }

  /**
   * When this response was assembled; see `revenue.computedAt` for the snapshot's age.
   * @return generatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("generatedAt")
  public OffsetDateTime getGeneratedAt() {
    return generatedAt;
  }

  @JsonProperty("generatedAt")
  public void setGeneratedAt(OffsetDateTime generatedAt) {
    this.generatedAt = generatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FinanceSnapshotResponseDto financeSnapshotResponseDto =
      (FinanceSnapshotResponseDto) o;
    return (
      Objects.equals(this.tenants, financeSnapshotResponseDto.tenants) &&
      Objects.equals(this.plans, financeSnapshotResponseDto.plans) &&
      Objects.equals(this.dunning, financeSnapshotResponseDto.dunning) &&
      Objects.equals(this.revenue, financeSnapshotResponseDto.revenue) &&
      Objects.equals(this.generatedAt, financeSnapshotResponseDto.generatedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(tenants, plans, dunning, revenue, generatedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FinanceSnapshotResponseDto {\n");
    sb.append("    tenants: ").append(toIndentedString(tenants)).append("\n");
    sb.append("    plans: ").append(toIndentedString(plans)).append("\n");
    sb.append("    dunning: ").append(toIndentedString(dunning)).append("\n");
    sb.append("    revenue: ").append(toIndentedString(revenue)).append("\n");
    sb.append("    generatedAt: ")
      .append(toIndentedString(generatedAt))
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

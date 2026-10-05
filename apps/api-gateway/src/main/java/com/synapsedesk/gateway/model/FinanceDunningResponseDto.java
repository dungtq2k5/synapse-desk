package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.DunningTenantResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * FinanceDunningResponseDto
 */

public class FinanceDunningResponseDto {

  private BigDecimal pastDue;

  private List<@Valid DunningTenantResponseDto> tenants = new ArrayList<>();

  public FinanceDunningResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FinanceDunningResponseDto(
    BigDecimal pastDue,
    List<@Valid DunningTenantResponseDto> tenants
  ) {
    this.pastDue = pastDue;
    this.tenants = tenants;
  }

  public FinanceDunningResponseDto pastDue(BigDecimal pastDue) {
    this.pastDue = pastDue;
    return this;
  }

  /**
   * Get pastDue
   * @return pastDue
   */
  @NotNull
  @Valid
  @JsonProperty("pastDue")
  public BigDecimal getPastDue() {
    return pastDue;
  }

  @JsonProperty("pastDue")
  public void setPastDue(BigDecimal pastDue) {
    this.pastDue = pastDue;
  }

  public FinanceDunningResponseDto tenants(
    List<@Valid DunningTenantResponseDto> tenants
  ) {
    this.tenants = tenants;
    return this;
  }

  public FinanceDunningResponseDto addTenantsItem(
    DunningTenantResponseDto tenantsItem
  ) {
    if (this.tenants == null) {
      this.tenants = new ArrayList<>();
    }
    this.tenants.add(tenantsItem);
    return this;
  }

  /**
   * Get tenants
   * @return tenants
   */
  @NotNull
  @Valid
  @JsonProperty("tenants")
  public List<@Valid DunningTenantResponseDto> getTenants() {
    return tenants;
  }

  @JsonProperty("tenants")
  public void setTenants(List<@Valid DunningTenantResponseDto> tenants) {
    this.tenants = tenants;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FinanceDunningResponseDto financeDunningResponseDto =
      (FinanceDunningResponseDto) o;
    return (
      Objects.equals(this.pastDue, financeDunningResponseDto.pastDue) &&
      Objects.equals(this.tenants, financeDunningResponseDto.tenants)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(pastDue, tenants);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FinanceDunningResponseDto {\n");
    sb.append("    pastDue: ").append(toIndentedString(pastDue)).append("\n");
    sb.append("    tenants: ").append(toIndentedString(tenants)).append("\n");
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

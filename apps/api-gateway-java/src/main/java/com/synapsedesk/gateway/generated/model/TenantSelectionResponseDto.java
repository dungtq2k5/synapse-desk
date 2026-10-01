package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.TenantOptionResponseDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import com.fasterxml.jackson.annotation.JsonTypeName;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * TenantSelectionResponseDto
 */

public class TenantSelectionResponseDto implements AuthControllerLoginV1200ResponseData {

  private Boolean requiresTenantSelection;

  private List<@Valid TenantOptionResponseDto> tenants = new ArrayList<>();

  public TenantSelectionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TenantSelectionResponseDto(Boolean requiresTenantSelection, List<@Valid TenantOptionResponseDto> tenants) {
    this.requiresTenantSelection = requiresTenantSelection;
    this.tenants = tenants;
  }

  public TenantSelectionResponseDto requiresTenantSelection(Boolean requiresTenantSelection) {
    this.requiresTenantSelection = requiresTenantSelection;
    return this;
  }

  /**
   * Get requiresTenantSelection
   * @return requiresTenantSelection
   */
  @NotNull 
  @JsonProperty("requiresTenantSelection")
  public Boolean getRequiresTenantSelection() {
    return requiresTenantSelection;
  }

  @JsonProperty("requiresTenantSelection")
  public void setRequiresTenantSelection(Boolean requiresTenantSelection) {
    this.requiresTenantSelection = requiresTenantSelection;
  }

  public TenantSelectionResponseDto tenants(List<@Valid TenantOptionResponseDto> tenants) {
    this.tenants = tenants;
    return this;
  }

  public TenantSelectionResponseDto addTenantsItem(TenantOptionResponseDto tenantsItem) {
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
  @NotNull @Valid 
  @JsonProperty("tenants")
  public List<@Valid TenantOptionResponseDto> getTenants() {
    return tenants;
  }

  @JsonProperty("tenants")
  public void setTenants(List<@Valid TenantOptionResponseDto> tenants) {
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
    TenantSelectionResponseDto tenantSelectionResponseDto = (TenantSelectionResponseDto) o;
    return Objects.equals(this.requiresTenantSelection, tenantSelectionResponseDto.requiresTenantSelection) &&
        Objects.equals(this.tenants, tenantSelectionResponseDto.tenants);
  }

  @Override
  public int hashCode() {
    return Objects.hash(requiresTenantSelection, tenants);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TenantSelectionResponseDto {\n");
    sb.append("    requiresTenantSelection: ").append(toIndentedString(requiresTenantSelection)).append("\n");
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


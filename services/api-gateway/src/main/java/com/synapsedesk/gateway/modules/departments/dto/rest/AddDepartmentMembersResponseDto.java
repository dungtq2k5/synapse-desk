package com.synapsedesk.gateway.modules.departments.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AddDepartmentMembersResponseDto
 */

public class AddDepartmentMembersResponseDto {

  private BigDecimal addedCount;

  private BigDecimal updatedCount;

  public AddDepartmentMembersResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AddDepartmentMembersResponseDto(
    BigDecimal addedCount,
    BigDecimal updatedCount
  ) {
    this.addedCount = addedCount;
    this.updatedCount = updatedCount;
  }

  public AddDepartmentMembersResponseDto addedCount(BigDecimal addedCount) {
    this.addedCount = addedCount;
    return this;
  }

  /**
   * New memberships.
   * @return addedCount
   */
  @NotNull
  @Valid
  @JsonProperty("addedCount")
  public BigDecimal getAddedCount() {
    return addedCount;
  }

  @JsonProperty("addedCount")
  public void setAddedCount(BigDecimal addedCount) {
    this.addedCount = addedCount;
  }

  public AddDepartmentMembersResponseDto updatedCount(BigDecimal updatedCount) {
    this.updatedCount = updatedCount;
    return this;
  }

  /**
   * Existing memberships whose `isPrimary`/assigner were refreshed instead.
   * @return updatedCount
   */
  @NotNull
  @Valid
  @JsonProperty("updatedCount")
  public BigDecimal getUpdatedCount() {
    return updatedCount;
  }

  @JsonProperty("updatedCount")
  public void setUpdatedCount(BigDecimal updatedCount) {
    this.updatedCount = updatedCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AddDepartmentMembersResponseDto addDepartmentMembersResponseDto =
      (AddDepartmentMembersResponseDto) o;
    return (
      Objects.equals(
        this.addedCount,
        addDepartmentMembersResponseDto.addedCount
      ) &&
      Objects.equals(
        this.updatedCount,
        addDepartmentMembersResponseDto.updatedCount
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(addedCount, updatedCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AddDepartmentMembersResponseDto {\n");
    sb.append("    addedCount: ")
      .append(toIndentedString(addedCount))
      .append("\n");
    sb.append("    updatedCount: ")
      .append(toIndentedString(updatedCount))
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

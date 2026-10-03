package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * DepartmentAssignmentDto
 */

public class DepartmentAssignmentDto {

  private UUID departmentId;

  private Boolean isPrimary;

  public DepartmentAssignmentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DepartmentAssignmentDto(UUID departmentId, Boolean isPrimary) {
    this.departmentId = departmentId;
    this.isPrimary = isPrimary;
  }

  public DepartmentAssignmentDto departmentId(UUID departmentId) {
    this.departmentId = departmentId;
    return this;
  }

  /**
   * Get departmentId
   * @return departmentId
   */
  @NotNull
  @Valid
  @JsonProperty("departmentId")
  public UUID getDepartmentId() {
    return departmentId;
  }

  @JsonProperty("departmentId")
  public void setDepartmentId(UUID departmentId) {
    this.departmentId = departmentId;
  }

  public DepartmentAssignmentDto isPrimary(Boolean isPrimary) {
    this.isPrimary = isPrimary;
    return this;
  }

  /**
   * Get isPrimary
   * @return isPrimary
   */
  @NotNull
  @JsonProperty("isPrimary")
  public Boolean getIsPrimary() {
    return isPrimary;
  }

  @JsonProperty("isPrimary")
  public void setIsPrimary(Boolean isPrimary) {
    this.isPrimary = isPrimary;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DepartmentAssignmentDto departmentAssignmentDto =
      (DepartmentAssignmentDto) o;
    return (
      Objects.equals(this.departmentId, departmentAssignmentDto.departmentId) &&
      Objects.equals(this.isPrimary, departmentAssignmentDto.isPrimary)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(departmentId, isPrimary);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DepartmentAssignmentDto {\n");
    sb.append("    departmentId: ")
      .append(toIndentedString(departmentId))
      .append("\n");
    sb.append("    isPrimary: ")
      .append(toIndentedString(isPrimary))
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

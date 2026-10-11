package com.synapsedesk.gateway.modules.users.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.users.dto.rest.DepartmentAssignmentDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SetUserDepartmentsDto
 */

public class SetUserDepartmentsDto {

  private List<@Valid DepartmentAssignmentDto> departments = new ArrayList<>();

  public SetUserDepartmentsDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SetUserDepartmentsDto(
    List<@Valid DepartmentAssignmentDto> departments
  ) {
    this.departments = departments;
  }

  public SetUserDepartmentsDto departments(
    List<@Valid DepartmentAssignmentDto> departments
  ) {
    this.departments = departments;
    return this;
  }

  public SetUserDepartmentsDto addDepartmentsItem(
    DepartmentAssignmentDto departmentsItem
  ) {
    if (this.departments == null) {
      this.departments = new ArrayList<>();
    }
    this.departments.add(departmentsItem);
    return this;
  }

  /**
   * The departments to assign, and which of them is primary.  Exactly one entry must be primary when the list is non-empty; the service enforces it, because zero is as invalid as two.
   * @return departments
   */
  @NotNull
  @Valid
  @Size(max = 50)
  @JsonProperty("departments")
  public List<@Valid DepartmentAssignmentDto> getDepartments() {
    return departments;
  }

  @JsonProperty("departments")
  public void setDepartments(List<@Valid DepartmentAssignmentDto> departments) {
    this.departments = departments;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SetUserDepartmentsDto setUserDepartmentsDto = (SetUserDepartmentsDto) o;
    return Objects.equals(this.departments, setUserDepartmentsDto.departments);
  }

  @Override
  public int hashCode() {
    return Objects.hash(departments);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SetUserDepartmentsDto {\n");
    sb.append("    departments: ")
      .append(toIndentedString(departments))
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

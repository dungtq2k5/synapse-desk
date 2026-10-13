package com.synapsedesk.gateway.modules.documents.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * DocumentDepartmentsResponseDto
 */

public class DocumentDepartmentsResponseDto {

  private List<String> departmentIds = new ArrayList<>();

  public DocumentDepartmentsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentDepartmentsResponseDto(List<String> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public DocumentDepartmentsResponseDto departmentIds(
    List<String> departmentIds
  ) {
    this.departmentIds = departmentIds;
    return this;
  }

  public DocumentDepartmentsResponseDto addDepartmentIdsItem(
    String departmentIdsItem
  ) {
    if (this.departmentIds == null) {
      this.departmentIds = new ArrayList<>();
    }
    this.departmentIds.add(departmentIdsItem);
    return this;
  }

  /**
   * Get departmentIds
   * @return departmentIds
   */
  @NotNull
  @JsonProperty("departmentIds")
  public List<String> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentDepartmentsResponseDto documentDepartmentsResponseDto =
      (DocumentDepartmentsResponseDto) o;
    return Objects.equals(
      this.departmentIds,
      documentDepartmentsResponseDto.departmentIds
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(departmentIds);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentDepartmentsResponseDto {\n");
    sb.append("    departmentIds: ")
      .append(toIndentedString(departmentIds))
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

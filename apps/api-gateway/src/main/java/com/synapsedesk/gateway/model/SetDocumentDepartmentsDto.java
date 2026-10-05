package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * SetDocumentDepartmentsDto
 */

public class SetDocumentDepartmentsDto {

  private List<UUID> departmentIds = new ArrayList<>();

  public SetDocumentDepartmentsDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SetDocumentDepartmentsDto(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public SetDocumentDepartmentsDto departmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public SetDocumentDepartmentsDto addDepartmentIdsItem(
    UUID departmentIdsItem
  ) {
    if (this.departmentIds == null) {
      this.departmentIds = new ArrayList<>();
    }
    this.departmentIds.add(departmentIdsItem);
    return this;
  }

  /**
   * The FULL replacement set, not a delta.  Replacement rather than add/remove because the fan-out ordering ( The fan-out ordering turns on whether a change restricts, and that is answerable from a before/after pair but not from a stream of deltas applied in unknown order.
   * @return departmentIds
   */
  @NotNull
  @Valid
  @JsonProperty("departmentIds")
  public List<UUID> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<UUID> departmentIds) {
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
    SetDocumentDepartmentsDto setDocumentDepartmentsDto =
      (SetDocumentDepartmentsDto) o;
    return Objects.equals(
      this.departmentIds,
      setDocumentDepartmentsDto.departmentIds
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(departmentIds);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SetDocumentDepartmentsDto {\n");
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

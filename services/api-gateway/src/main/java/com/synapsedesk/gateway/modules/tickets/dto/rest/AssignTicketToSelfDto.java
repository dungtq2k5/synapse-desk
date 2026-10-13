package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * AssignTicketToSelfDto
 */

public class AssignTicketToSelfDto {

  private UUID departmentId;

  public AssignTicketToSelfDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AssignTicketToSelfDto(UUID departmentId) {
    this.departmentId = departmentId;
  }

  public AssignTicketToSelfDto departmentId(UUID departmentId) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AssignTicketToSelfDto assignTicketToSelfDto = (AssignTicketToSelfDto) o;
    return Objects.equals(
      this.departmentId,
      assignTicketToSelfDto.departmentId
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(departmentId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AssignTicketToSelfDto {\n");
    sb.append("    departmentId: ")
      .append(toIndentedString(departmentId))
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

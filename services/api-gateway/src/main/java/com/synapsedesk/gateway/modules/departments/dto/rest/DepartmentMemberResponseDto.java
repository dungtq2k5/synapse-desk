package com.synapsedesk.gateway.modules.departments.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * DepartmentMemberResponseDto
 */

public class DepartmentMemberResponseDto {

  private Object user;

  private Boolean isPrimary;

  private String assignedByName = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime assignedAt;

  public DepartmentMemberResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DepartmentMemberResponseDto(
    Object user,
    Boolean isPrimary,
    String assignedByName,
    OffsetDateTime assignedAt
  ) {
    this.user = user;
    this.isPrimary = isPrimary;
    this.assignedByName = assignedByName;
    this.assignedAt = assignedAt;
  }

  public DepartmentMemberResponseDto user(Object user) {
    this.user = user;
    return this;
  }

  /**
   * Get user
   * @return user
   */
  @NotNull
  @Schema(types = { "object" })
  @JsonProperty("user")
  public Object getUser() {
    return user;
  }

  @JsonProperty("user")
  public void setUser(Object user) {
    this.user = user;
  }

  public DepartmentMemberResponseDto isPrimary(Boolean isPrimary) {
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

  public DepartmentMemberResponseDto assignedByName(String assignedByName) {
    this.assignedByName = assignedByName;
    return this;
  }

  /**
   * Get assignedByName
   * @return assignedByName
   */

  @JsonProperty("assignedByName")
  public String getAssignedByName() {
    return assignedByName;
  }

  @JsonProperty("assignedByName")
  public void setAssignedByName(String assignedByName) {
    this.assignedByName = assignedByName;
  }

  public DepartmentMemberResponseDto assignedAt(OffsetDateTime assignedAt) {
    this.assignedAt = assignedAt;
    return this;
  }

  /**
   * Get assignedAt
   * @return assignedAt
   */
  @NotNull
  @Valid
  @JsonProperty("assignedAt")
  public OffsetDateTime getAssignedAt() {
    return assignedAt;
  }

  @JsonProperty("assignedAt")
  public void setAssignedAt(OffsetDateTime assignedAt) {
    this.assignedAt = assignedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DepartmentMemberResponseDto departmentMemberResponseDto =
      (DepartmentMemberResponseDto) o;
    return (
      Objects.equals(this.user, departmentMemberResponseDto.user) &&
      Objects.equals(this.isPrimary, departmentMemberResponseDto.isPrimary) &&
      Objects.equals(
        this.assignedByName,
        departmentMemberResponseDto.assignedByName
      ) &&
      Objects.equals(this.assignedAt, departmentMemberResponseDto.assignedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(user, isPrimary, assignedByName, assignedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DepartmentMemberResponseDto {\n");
    sb.append("    user: ").append(toIndentedString(user)).append("\n");
    sb.append("    isPrimary: ")
      .append(toIndentedString(isPrimary))
      .append("\n");
    sb.append("    assignedByName: ")
      .append(toIndentedString(assignedByName))
      .append("\n");
    sb.append("    assignedAt: ")
      .append(toIndentedString(assignedAt))
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

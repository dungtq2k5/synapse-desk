package com.synapsedesk.gateway.modules.users.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * CreateUserDto
 */

public class CreateUserDto {

  private List<UUID> roleIds = new ArrayList<>();

  private List<UUID> departmentIds = new ArrayList<>();

  private String email;

  private String fullName;

  private @Nullable UUID primaryDepartmentId;

  public CreateUserDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateUserDto(String email, String fullName) {
    this.email = email;
    this.fullName = fullName;
  }

  public CreateUserDto roleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public CreateUserDto addRoleIdsItem(UUID roleIdsItem) {
    if (this.roleIds == null) {
      this.roleIds = new ArrayList<>();
    }
    this.roleIds.add(roleIdsItem);
    return this;
  }

  /**
   * Get roleIds
   * @return roleIds
   */
  @Valid
  @Schema(defaultValue = "[]")
  @JsonProperty("roleIds")
  public List<UUID> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
  }

  public CreateUserDto departmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public CreateUserDto addDepartmentIdsItem(UUID departmentIdsItem) {
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
  @Valid
  @Schema(defaultValue = "[]")
  @JsonProperty("departmentIds")
  public List<UUID> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public CreateUserDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @jakarta.validation.constraints.Email
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public CreateUserDto fullName(String fullName) {
    this.fullName = fullName;
    return this;
  }

  /**
   * Get fullName
   * @return fullName
   */
  @NotNull
  @Size(min = 2, max = 150)
  @JsonProperty("fullName")
  public String getFullName() {
    return fullName;
  }

  @JsonProperty("fullName")
  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public CreateUserDto primaryDepartmentId(@Nullable UUID primaryDepartmentId) {
    this.primaryDepartmentId = primaryDepartmentId;
    return this;
  }

  /**
   * Get primaryDepartmentId
   * @return primaryDepartmentId
   */
  @Valid
  @JsonProperty("primaryDepartmentId")
  public @Nullable UUID getPrimaryDepartmentId() {
    return primaryDepartmentId;
  }

  @JsonProperty("primaryDepartmentId")
  public void setPrimaryDepartmentId(@Nullable UUID primaryDepartmentId) {
    this.primaryDepartmentId = primaryDepartmentId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateUserDto createUserDto = (CreateUserDto) o;
    return (
      Objects.equals(this.roleIds, createUserDto.roleIds) &&
      Objects.equals(this.departmentIds, createUserDto.departmentIds) &&
      Objects.equals(this.email, createUserDto.email) &&
      Objects.equals(this.fullName, createUserDto.fullName) &&
      Objects.equals(
        this.primaryDepartmentId,
        createUserDto.primaryDepartmentId
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      roleIds,
      departmentIds,
      email,
      fullName,
      primaryDepartmentId
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateUserDto {\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
    sb.append("    departmentIds: ")
      .append(toIndentedString(departmentIds))
      .append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    primaryDepartmentId: ")
      .append(toIndentedString(primaryDepartmentId))
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

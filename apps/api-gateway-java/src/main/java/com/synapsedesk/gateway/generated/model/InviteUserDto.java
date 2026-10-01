package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * InviteUserDto
 */

public class InviteUserDto {

  private List<UUID> roleIds = new ArrayList<>();

  private List<UUID> departmentIds = new ArrayList<>();

  private String email;

  private @Nullable UUID primaryDepartmentId;

  public InviteUserDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InviteUserDto(String email) {
    this.email = email;
  }

  public InviteUserDto roleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public InviteUserDto addRoleIdsItem(UUID roleIdsItem) {
    if (this.roleIds == null) {
      this.roleIds = new ArrayList<>();
    }
    this.roleIds.add(roleIdsItem);
    return this;
  }

  /**
   * PROPOSALS, resolved at redemption rather than now. A role deleted during the 7-day window is skipped and reported, never fatal.
   * @return roleIds
   */
  @Valid 
  @JsonProperty("roleIds")
  public List<UUID> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
  }

  public InviteUserDto departmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public InviteUserDto addDepartmentIdsItem(UUID departmentIdsItem) {
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
  @JsonProperty("departmentIds")
  public List<UUID> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public InviteUserDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull @jakarta.validation.constraints.Email 
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public InviteUserDto primaryDepartmentId(@Nullable UUID primaryDepartmentId) {
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
    InviteUserDto inviteUserDto = (InviteUserDto) o;
    return Objects.equals(this.roleIds, inviteUserDto.roleIds) &&
        Objects.equals(this.departmentIds, inviteUserDto.departmentIds) &&
        Objects.equals(this.email, inviteUserDto.email) &&
        Objects.equals(this.primaryDepartmentId, inviteUserDto.primaryDepartmentId);
  }

  @Override
  public int hashCode() {
    return Objects.hash(roleIds, departmentIds, email, primaryDepartmentId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InviteUserDto {\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
    sb.append("    departmentIds: ").append(toIndentedString(departmentIds)).append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    primaryDepartmentId: ").append(toIndentedString(primaryDepartmentId)).append("\n");
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


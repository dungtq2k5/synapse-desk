package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.UserResponseDto;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * UserSummaryResponseDto
 */

public class UserSummaryResponseDto {

  private UserResponseDto user;

  private List<String> roleIds = new ArrayList<>();

  private List<String> roleNames = new ArrayList<>();

  private List<String> departmentIds = new ArrayList<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  private String deletedByName = null;

  public UserSummaryResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UserSummaryResponseDto(UserResponseDto user, List<String> roleIds, List<String> roleNames, List<String> departmentIds, OffsetDateTime deletedAt, String deletedByName) {
    this.user = user;
    this.roleIds = roleIds;
    this.roleNames = roleNames;
    this.departmentIds = departmentIds;
    this.deletedAt = deletedAt;
    this.deletedByName = deletedByName;
  }

  public UserSummaryResponseDto user(UserResponseDto user) {
    this.user = user;
    return this;
  }

  /**
   * Get user
   * @return user
   */
  @NotNull @Valid 
  @JsonProperty("user")
  public UserResponseDto getUser() {
    return user;
  }

  @JsonProperty("user")
  public void setUser(UserResponseDto user) {
    this.user = user;
  }

  public UserSummaryResponseDto roleIds(List<String> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public UserSummaryResponseDto addRoleIdsItem(String roleIdsItem) {
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
  @NotNull 
  @JsonProperty("roleIds")
  public List<String> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<String> roleIds) {
    this.roleIds = roleIds;
  }

  public UserSummaryResponseDto roleNames(List<String> roleNames) {
    this.roleNames = roleNames;
    return this;
  }

  public UserSummaryResponseDto addRoleNamesItem(String roleNamesItem) {
    if (this.roleNames == null) {
      this.roleNames = new ArrayList<>();
    }
    this.roleNames.add(roleNamesItem);
    return this;
  }

  /**
   * Get roleNames
   * @return roleNames
   */
  @NotNull 
  @JsonProperty("roleNames")
  public List<String> getRoleNames() {
    return roleNames;
  }

  @JsonProperty("roleNames")
  public void setRoleNames(List<String> roleNames) {
    this.roleNames = roleNames;
  }

  public UserSummaryResponseDto departmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public UserSummaryResponseDto addDepartmentIdsItem(String departmentIdsItem) {
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

  public UserSummaryResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Non-null only on a deactivated account.
   * @return deletedAt
   */
  @Valid 
  @JsonProperty("deletedAt")
  public OffsetDateTime getDeletedAt() {
    return deletedAt;
  }

  @JsonProperty("deletedAt")
  public void setDeletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
  }

  public UserSummaryResponseDto deletedByName(String deletedByName) {
    this.deletedByName = deletedByName;
    return this;
  }

  /**
   * Get deletedByName
   * @return deletedByName
   */
  
  @JsonProperty("deletedByName")
  public String getDeletedByName() {
    return deletedByName;
  }

  @JsonProperty("deletedByName")
  public void setDeletedByName(String deletedByName) {
    this.deletedByName = deletedByName;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UserSummaryResponseDto userSummaryResponseDto = (UserSummaryResponseDto) o;
    return Objects.equals(this.user, userSummaryResponseDto.user) &&
        Objects.equals(this.roleIds, userSummaryResponseDto.roleIds) &&
        Objects.equals(this.roleNames, userSummaryResponseDto.roleNames) &&
        Objects.equals(this.departmentIds, userSummaryResponseDto.departmentIds) &&
        Objects.equals(this.deletedAt, userSummaryResponseDto.deletedAt) &&
        Objects.equals(this.deletedByName, userSummaryResponseDto.deletedByName);
  }

  @Override
  public int hashCode() {
    return Objects.hash(user, roleIds, roleNames, departmentIds, deletedAt, deletedByName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UserSummaryResponseDto {\n");
    sb.append("    user: ").append(toIndentedString(user)).append("\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
    sb.append("    roleNames: ").append(toIndentedString(roleNames)).append("\n");
    sb.append("    departmentIds: ").append(toIndentedString(departmentIds)).append("\n");
    sb.append("    deletedAt: ").append(toIndentedString(deletedAt)).append("\n");
    sb.append("    deletedByName: ").append(toIndentedString(deletedByName)).append("\n");
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


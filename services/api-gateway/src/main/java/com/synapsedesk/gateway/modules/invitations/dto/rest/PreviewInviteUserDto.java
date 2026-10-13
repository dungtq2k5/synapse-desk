package com.synapsedesk.gateway.modules.invitations.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * PreviewInviteUserDto
 */

public class PreviewInviteUserDto {

  private List<@Size(max = 64) String> roleIds = new ArrayList<>();

  private List<@Size(max = 64) String> departmentIds = new ArrayList<>();

  private String email;

  private @Nullable String primaryDepartmentId;

  public PreviewInviteUserDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PreviewInviteUserDto(String email) {
    this.email = email;
  }

  public PreviewInviteUserDto roleIds(List<@Size(max = 64) String> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public PreviewInviteUserDto addRoleIdsItem(String roleIdsItem) {
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

  @Schema(defaultValue = "[]")
  @JsonProperty("roleIds")
  public List<@Size(max = 64) String> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<@Size(max = 64) String> roleIds) {
    this.roleIds = roleIds;
  }

  public PreviewInviteUserDto departmentIds(
    List<@Size(max = 64) String> departmentIds
  ) {
    this.departmentIds = departmentIds;
    return this;
  }

  public PreviewInviteUserDto addDepartmentIdsItem(String departmentIdsItem) {
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

  @Schema(defaultValue = "[]")
  @JsonProperty("departmentIds")
  public List<@Size(max = 64) String> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<@Size(max = 64) String> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public PreviewInviteUserDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @Size(max = 320)
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public PreviewInviteUserDto primaryDepartmentId(
    @Nullable String primaryDepartmentId
  ) {
    this.primaryDepartmentId = primaryDepartmentId;
    return this;
  }

  /**
   * Get primaryDepartmentId
   * @return primaryDepartmentId
   */
  @Size(max = 64)
  @JsonProperty("primaryDepartmentId")
  public @Nullable String getPrimaryDepartmentId() {
    return primaryDepartmentId;
  }

  @JsonProperty("primaryDepartmentId")
  public void setPrimaryDepartmentId(@Nullable String primaryDepartmentId) {
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
    PreviewInviteUserDto previewInviteUserDto = (PreviewInviteUserDto) o;
    return (
      Objects.equals(this.roleIds, previewInviteUserDto.roleIds) &&
      Objects.equals(this.departmentIds, previewInviteUserDto.departmentIds) &&
      Objects.equals(this.email, previewInviteUserDto.email) &&
      Objects.equals(
        this.primaryDepartmentId,
        previewInviteUserDto.primaryDepartmentId
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(roleIds, departmentIds, email, primaryDepartmentId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PreviewInviteUserDto {\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
    sb.append("    departmentIds: ")
      .append(toIndentedString(departmentIds))
      .append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
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

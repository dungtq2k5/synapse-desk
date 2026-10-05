package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.UserResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * PlatformUserResponseDto
 */

public class PlatformUserResponseDto {

  private UserResponseDto user;

  private String organizationId = null;

  private String organizationName = null;

  private List<String> roleNames = new ArrayList<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  public PlatformUserResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlatformUserResponseDto(
    UserResponseDto user,
    String organizationId,
    String organizationName,
    List<String> roleNames,
    OffsetDateTime deletedAt
  ) {
    this.user = user;
    this.organizationId = organizationId;
    this.organizationName = organizationName;
    this.roleNames = roleNames;
    this.deletedAt = deletedAt;
  }

  public PlatformUserResponseDto user(UserResponseDto user) {
    this.user = user;
    return this;
  }

  /**
   * Get user
   * @return user
   */
  @NotNull
  @Valid
  @JsonProperty("user")
  public UserResponseDto getUser() {
    return user;
  }

  @JsonProperty("user")
  public void setUser(UserResponseDto user) {
    this.user = user;
  }

  public PlatformUserResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Always present on a tenant user; null only for a platform Super Admin.
   * @return organizationId
   */

  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public PlatformUserResponseDto organizationName(String organizationName) {
    this.organizationName = organizationName;
    return this;
  }

  /**
   * Get organizationName
   * @return organizationName
   */

  @JsonProperty("organizationName")
  public String getOrganizationName() {
    return organizationName;
  }

  @JsonProperty("organizationName")
  public void setOrganizationName(String organizationName) {
    this.organizationName = organizationName;
  }

  public PlatformUserResponseDto roleNames(List<String> roleNames) {
    this.roleNames = roleNames;
    return this;
  }

  public PlatformUserResponseDto addRoleNamesItem(String roleNamesItem) {
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

  public PlatformUserResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Get deletedAt
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlatformUserResponseDto platformUserResponseDto =
      (PlatformUserResponseDto) o;
    return (
      Objects.equals(this.user, platformUserResponseDto.user) &&
      Objects.equals(
        this.organizationId,
        platformUserResponseDto.organizationId
      ) &&
      Objects.equals(
        this.organizationName,
        platformUserResponseDto.organizationName
      ) &&
      Objects.equals(this.roleNames, platformUserResponseDto.roleNames) &&
      Objects.equals(this.deletedAt, platformUserResponseDto.deletedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      user,
      organizationId,
      organizationName,
      roleNames,
      deletedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformUserResponseDto {\n");
    sb.append("    user: ").append(toIndentedString(user)).append("\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    organizationName: ")
      .append(toIndentedString(organizationName))
      .append("\n");
    sb.append("    roleNames: ")
      .append(toIndentedString(roleNames))
      .append("\n");
    sb.append("    deletedAt: ")
      .append(toIndentedString(deletedAt))
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

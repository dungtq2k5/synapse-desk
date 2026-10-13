package com.synapsedesk.gateway.modules.invitations.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * PreviewInvitationResponseDto
 */

public class PreviewInvitationResponseDto {

  private Boolean valid;

  private String organizationName = null;

  private String inviterName = null;

  private String email = null;

  private List<String> roleNames = new ArrayList<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt = null;

  public PreviewInvitationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PreviewInvitationResponseDto(
    Boolean valid,
    String organizationName,
    String inviterName,
    String email,
    List<String> roleNames,
    OffsetDateTime expiresAt
  ) {
    this.valid = valid;
    this.organizationName = organizationName;
    this.inviterName = inviterName;
    this.email = email;
    this.roleNames = roleNames;
    this.expiresAt = expiresAt;
  }

  public PreviewInvitationResponseDto valid(Boolean valid) {
    this.valid = valid;
    return this;
  }

  /**
   * Get valid
   * @return valid
   */
  @NotNull
  @JsonProperty("valid")
  public Boolean getValid() {
    return valid;
  }

  @JsonProperty("valid")
  public void setValid(Boolean valid) {
    this.valid = valid;
  }

  public PreviewInvitationResponseDto organizationName(
    String organizationName
  ) {
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

  public PreviewInvitationResponseDto inviterName(String inviterName) {
    this.inviterName = inviterName;
    return this;
  }

  /**
   * Get inviterName
   * @return inviterName
   */

  @JsonProperty("inviterName")
  public String getInviterName() {
    return inviterName;
  }

  @JsonProperty("inviterName")
  public void setInviterName(String inviterName) {
    this.inviterName = inviterName;
  }

  public PreviewInvitationResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */

  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public PreviewInvitationResponseDto roleNames(List<String> roleNames) {
    this.roleNames = roleNames;
    return this;
  }

  public PreviewInvitationResponseDto addRoleNamesItem(String roleNamesItem) {
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

  public PreviewInvitationResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @Valid
  @JsonProperty("expiresAt")
  public OffsetDateTime getExpiresAt() {
    return expiresAt;
  }

  @JsonProperty("expiresAt")
  public void setExpiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PreviewInvitationResponseDto previewInvitationResponseDto =
      (PreviewInvitationResponseDto) o;
    return (
      Objects.equals(this.valid, previewInvitationResponseDto.valid) &&
      Objects.equals(
        this.organizationName,
        previewInvitationResponseDto.organizationName
      ) &&
      Objects.equals(
        this.inviterName,
        previewInvitationResponseDto.inviterName
      ) &&
      Objects.equals(this.email, previewInvitationResponseDto.email) &&
      Objects.equals(this.roleNames, previewInvitationResponseDto.roleNames) &&
      Objects.equals(this.expiresAt, previewInvitationResponseDto.expiresAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      valid,
      organizationName,
      inviterName,
      email,
      roleNames,
      expiresAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PreviewInvitationResponseDto {\n");
    sb.append("    valid: ").append(toIndentedString(valid)).append("\n");
    sb.append("    organizationName: ")
      .append(toIndentedString(organizationName))
      .append("\n");
    sb.append("    inviterName: ")
      .append(toIndentedString(inviterName))
      .append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    roleNames: ")
      .append(toIndentedString(roleNames))
      .append("\n");
    sb.append("    expiresAt: ")
      .append(toIndentedString(expiresAt))
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

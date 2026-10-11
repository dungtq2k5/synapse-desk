package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.validation.StrongPassword;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * ChangePasswordDto
 */

public class ChangePasswordDto {

  private String currentPassword;

  private String newPassword;

  public ChangePasswordDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ChangePasswordDto(String currentPassword, String newPassword) {
    this.currentPassword = currentPassword;
    this.newPassword = newPassword;
  }

  public ChangePasswordDto currentPassword(String currentPassword) {
    this.currentPassword = currentPassword;
    return this;
  }

  /**
   * Get currentPassword
   * @return currentPassword
   */
  @NotNull
  @Size(min = 1)
  @JsonProperty("currentPassword")
  public String getCurrentPassword() {
    return currentPassword;
  }

  @JsonProperty("currentPassword")
  public void setCurrentPassword(String currentPassword) {
    this.currentPassword = currentPassword;
  }

  public ChangePasswordDto newPassword(String newPassword) {
    this.newPassword = newPassword;
    return this;
  }

  /**
   * Get newPassword
   * @return newPassword
   */
  @NotNull
  @StrongPassword
  @JsonProperty("newPassword")
  public String getNewPassword() {
    return newPassword;
  }

  @JsonProperty("newPassword")
  public void setNewPassword(String newPassword) {
    this.newPassword = newPassword;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ChangePasswordDto changePasswordDto = (ChangePasswordDto) o;
    return (
      Objects.equals(this.currentPassword, changePasswordDto.currentPassword) &&
      Objects.equals(this.newPassword, changePasswordDto.newPassword)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(currentPassword, newPassword);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ChangePasswordDto {\n");
    sb.append("    currentPassword: ")
      .append(toIndentedString(currentPassword))
      .append("\n");
    sb.append("    newPassword: ")
      .append(toIndentedString(newPassword))
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

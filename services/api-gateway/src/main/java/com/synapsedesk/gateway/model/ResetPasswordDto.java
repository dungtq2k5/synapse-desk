package com.synapsedesk.gateway.model;

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
 * ResetPasswordDto
 */

public class ResetPasswordDto {

  private String token;

  private String newPassword;

  public ResetPasswordDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ResetPasswordDto(String token, String newPassword) {
    this.token = token;
    this.newPassword = newPassword;
  }

  public ResetPasswordDto token(String token) {
    this.token = token;
    return this;
  }

  /**
   * Get token
   * @return token
   */
  @NotNull
  @Size(min = 1, max = 256)
  @JsonProperty("token")
  public String getToken() {
    return token;
  }

  @JsonProperty("token")
  public void setToken(String token) {
    this.token = token;
  }

  public ResetPasswordDto newPassword(String newPassword) {
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
    ResetPasswordDto resetPasswordDto = (ResetPasswordDto) o;
    return (
      Objects.equals(this.token, resetPasswordDto.token) &&
      Objects.equals(this.newPassword, resetPasswordDto.newPassword)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(token, newPassword);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ResetPasswordDto {\n");
    sb.append("    token: ").append(toIndentedString(token)).append("\n");
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

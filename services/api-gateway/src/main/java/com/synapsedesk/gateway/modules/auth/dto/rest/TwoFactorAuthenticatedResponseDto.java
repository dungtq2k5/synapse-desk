package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.dto.UserResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * TwoFactorAuthenticatedResponseDto
 */

public class TwoFactorAuthenticatedResponseDto {

  private UserResponseDto user;

  private String warning = null;

  public TwoFactorAuthenticatedResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TwoFactorAuthenticatedResponseDto(
    UserResponseDto user,
    String warning
  ) {
    this.user = user;
    this.warning = warning;
  }

  public TwoFactorAuthenticatedResponseDto user(UserResponseDto user) {
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

  public TwoFactorAuthenticatedResponseDto warning(String warning) {
    this.warning = warning;
    return this;
  }

  /**
   * Get warning
   * @return warning
   */

  @JsonProperty("warning")
  public String getWarning() {
    return warning;
  }

  @JsonProperty("warning")
  public void setWarning(String warning) {
    this.warning = warning;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TwoFactorAuthenticatedResponseDto twoFactorAuthenticatedResponseDto =
      (TwoFactorAuthenticatedResponseDto) o;
    return (
      Objects.equals(this.user, twoFactorAuthenticatedResponseDto.user) &&
      Objects.equals(this.warning, twoFactorAuthenticatedResponseDto.warning)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(user, warning);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TwoFactorAuthenticatedResponseDto {\n");
    sb.append("    user: ").append(toIndentedString(user)).append("\n");
    sb.append("    warning: ").append(toIndentedString(warning)).append("\n");
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

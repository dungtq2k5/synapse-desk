package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonTypeName;
import com.synapsedesk.gateway.model.UserResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * LoginResponseDto
 */

public class LoginResponseDto {

  private UserResponseDto user;

  private Boolean requiresTwoFactor;

  public LoginResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public LoginResponseDto(UserResponseDto user, Boolean requiresTwoFactor) {
    this.user = user;
    this.requiresTwoFactor = requiresTwoFactor;
  }

  public LoginResponseDto user(UserResponseDto user) {
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

  public LoginResponseDto requiresTwoFactor(Boolean requiresTwoFactor) {
    this.requiresTwoFactor = requiresTwoFactor;
    return this;
  }

  /**
   * Get requiresTwoFactor
   * @return requiresTwoFactor
   */
  @NotNull
  @JsonProperty("requiresTwoFactor")
  public Boolean getRequiresTwoFactor() {
    return requiresTwoFactor;
  }

  @JsonProperty("requiresTwoFactor")
  public void setRequiresTwoFactor(Boolean requiresTwoFactor) {
    this.requiresTwoFactor = requiresTwoFactor;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    LoginResponseDto loginResponseDto = (LoginResponseDto) o;
    return (
      Objects.equals(this.user, loginResponseDto.user) &&
      Objects.equals(this.requiresTwoFactor, loginResponseDto.requiresTwoFactor)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(user, requiresTwoFactor);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LoginResponseDto {\n");
    sb.append("    user: ").append(toIndentedString(user)).append("\n");
    sb.append("    requiresTwoFactor: ")
      .append(toIndentedString(requiresTwoFactor))
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

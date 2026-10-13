package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.validation.StrongPassword;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * RegisterDto
 */

public class RegisterDto {

  private String email;

  private String password;

  private String fullName;

  public RegisterDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RegisterDto(String email, String password, String fullName) {
    this.email = email;
    this.password = password;
    this.fullName = fullName;
  }

  public RegisterDto email(String email) {
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

  public RegisterDto password(String password) {
    this.password = password;
    return this;
  }

  /**
   * Get password
   * @return password
   */
  @NotNull
  @StrongPassword
  @JsonProperty("password")
  public String getPassword() {
    return password;
  }

  @JsonProperty("password")
  public void setPassword(String password) {
    this.password = password;
  }

  public RegisterDto fullName(String fullName) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RegisterDto registerDto = (RegisterDto) o;
    return (
      Objects.equals(this.email, registerDto.email) &&
      Objects.equals(this.password, registerDto.password) &&
      Objects.equals(this.fullName, registerDto.fullName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(email, password, fullName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RegisterDto {\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    password: ").append(toIndentedString(password)).append("\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
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

package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * ValidatePasswordResetTokenResponseDto
 */

public class ValidatePasswordResetTokenResponseDto {

  private Boolean valid;

  private String email = null;

  public ValidatePasswordResetTokenResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ValidatePasswordResetTokenResponseDto(Boolean valid, String email) {
    this.valid = valid;
    this.email = email;
  }

  public ValidatePasswordResetTokenResponseDto valid(Boolean valid) {
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

  public ValidatePasswordResetTokenResponseDto email(String email) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ValidatePasswordResetTokenResponseDto validatePasswordResetTokenResponseDto =
      (ValidatePasswordResetTokenResponseDto) o;
    return (
      Objects.equals(this.valid, validatePasswordResetTokenResponseDto.valid) &&
      Objects.equals(this.email, validatePasswordResetTokenResponseDto.email)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(valid, email);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ValidatePasswordResetTokenResponseDto {\n");
    sb.append("    valid: ").append(toIndentedString(valid)).append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
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

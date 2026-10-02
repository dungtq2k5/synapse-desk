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
 * FailedInvitationResponseDto
 */

public class FailedInvitationResponseDto {

  private String email;

  private String reason;

  public FailedInvitationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FailedInvitationResponseDto(String email, String reason) {
    this.email = email;
    this.reason = reason;
  }

  public FailedInvitationResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public FailedInvitationResponseDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */
  @NotNull
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    FailedInvitationResponseDto failedInvitationResponseDto =
      (FailedInvitationResponseDto) o;
    return (
      Objects.equals(this.email, failedInvitationResponseDto.email) &&
      Objects.equals(this.reason, failedInvitationResponseDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(email, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FailedInvitationResponseDto {\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
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

package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.validation.ValidPhoneNumber;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * RequestPhoneVerificationDto
 */

public class RequestPhoneVerificationDto {

  private String phoneNumber;

  public RequestPhoneVerificationDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RequestPhoneVerificationDto(String phoneNumber) {
    this.phoneNumber = phoneNumber;
  }

  public RequestPhoneVerificationDto phoneNumber(String phoneNumber) {
    this.phoneNumber = phoneNumber;
    return this;
  }

  /**
   * Becomes `otps.target`. `users.phone_number` is not touched until a code for this exact number verifies, which is what lets one endpoint serve both first-time verification and change-of-number.
   * @return phoneNumber
   */
  @NotNull
  @ValidPhoneNumber
  @JsonProperty("phoneNumber")
  public String getPhoneNumber() {
    return phoneNumber;
  }

  @JsonProperty("phoneNumber")
  public void setPhoneNumber(String phoneNumber) {
    this.phoneNumber = phoneNumber;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RequestPhoneVerificationDto requestPhoneVerificationDto =
      (RequestPhoneVerificationDto) o;
    return Objects.equals(
      this.phoneNumber,
      requestPhoneVerificationDto.phoneNumber
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(phoneNumber);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RequestPhoneVerificationDto {\n");
    sb.append("    phoneNumber: ")
      .append(toIndentedString(phoneNumber))
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

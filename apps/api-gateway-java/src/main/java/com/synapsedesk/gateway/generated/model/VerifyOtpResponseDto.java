package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * VerifyOtpResponseDto
 */

public class VerifyOtpResponseDto {

  private Boolean verified;

  private BigDecimal attemptsRemaining;

  private Boolean mustRequestNewCode;

  public VerifyOtpResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public VerifyOtpResponseDto(Boolean verified, BigDecimal attemptsRemaining, Boolean mustRequestNewCode) {
    this.verified = verified;
    this.attemptsRemaining = attemptsRemaining;
    this.mustRequestNewCode = mustRequestNewCode;
  }

  public VerifyOtpResponseDto verified(Boolean verified) {
    this.verified = verified;
    return this;
  }

  /**
   * Get verified
   * @return verified
   */
  @NotNull 
  @JsonProperty("verified")
  public Boolean getVerified() {
    return verified;
  }

  @JsonProperty("verified")
  public void setVerified(Boolean verified) {
    this.verified = verified;
  }

  public VerifyOtpResponseDto attemptsRemaining(BigDecimal attemptsRemaining) {
    this.attemptsRemaining = attemptsRemaining;
    return this;
  }

  /**
   * Get attemptsRemaining
   * @return attemptsRemaining
   */
  @NotNull @Valid 
  @JsonProperty("attemptsRemaining")
  public BigDecimal getAttemptsRemaining() {
    return attemptsRemaining;
  }

  @JsonProperty("attemptsRemaining")
  public void setAttemptsRemaining(BigDecimal attemptsRemaining) {
    this.attemptsRemaining = attemptsRemaining;
  }

  public VerifyOtpResponseDto mustRequestNewCode(Boolean mustRequestNewCode) {
    this.mustRequestNewCode = mustRequestNewCode;
    return this;
  }

  /**
   * Get mustRequestNewCode
   * @return mustRequestNewCode
   */
  @NotNull 
  @JsonProperty("mustRequestNewCode")
  public Boolean getMustRequestNewCode() {
    return mustRequestNewCode;
  }

  @JsonProperty("mustRequestNewCode")
  public void setMustRequestNewCode(Boolean mustRequestNewCode) {
    this.mustRequestNewCode = mustRequestNewCode;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    VerifyOtpResponseDto verifyOtpResponseDto = (VerifyOtpResponseDto) o;
    return Objects.equals(this.verified, verifyOtpResponseDto.verified) &&
        Objects.equals(this.attemptsRemaining, verifyOtpResponseDto.attemptsRemaining) &&
        Objects.equals(this.mustRequestNewCode, verifyOtpResponseDto.mustRequestNewCode);
  }

  @Override
  public int hashCode() {
    return Objects.hash(verified, attemptsRemaining, mustRequestNewCode);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class VerifyOtpResponseDto {\n");
    sb.append("    verified: ").append(toIndentedString(verified)).append("\n");
    sb.append("    attemptsRemaining: ").append(toIndentedString(attemptsRemaining)).append("\n");
    sb.append("    mustRequestNewCode: ").append(toIndentedString(mustRequestNewCode)).append("\n");
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


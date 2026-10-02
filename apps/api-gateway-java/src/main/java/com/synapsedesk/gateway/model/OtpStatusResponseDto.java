package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * OtpStatusResponseDto
 */

public class OtpStatusResponseDto {

  private Boolean pending;

  private String target = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt = null;

  private BigDecimal attemptsRemaining;

  public OtpStatusResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OtpStatusResponseDto(
    Boolean pending,
    String target,
    OffsetDateTime expiresAt,
    BigDecimal attemptsRemaining
  ) {
    this.pending = pending;
    this.target = target;
    this.expiresAt = expiresAt;
    this.attemptsRemaining = attemptsRemaining;
  }

  public OtpStatusResponseDto pending(Boolean pending) {
    this.pending = pending;
    return this;
  }

  /**
   * Get pending
   * @return pending
   */
  @NotNull
  @JsonProperty("pending")
  public Boolean getPending() {
    return pending;
  }

  @JsonProperty("pending")
  public void setPending(Boolean pending) {
    this.pending = pending;
  }

  public OtpStatusResponseDto target(String target) {
    this.target = target;
    return this;
  }

  /**
   * Get target
   * @return target
   */

  @JsonProperty("target")
  public String getTarget() {
    return target;
  }

  @JsonProperty("target")
  public void setTarget(String target) {
    this.target = target;
  }

  public OtpStatusResponseDto expiresAt(OffsetDateTime expiresAt) {
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

  public OtpStatusResponseDto attemptsRemaining(BigDecimal attemptsRemaining) {
    this.attemptsRemaining = attemptsRemaining;
    return this;
  }

  /**
   * Get attemptsRemaining
   * @return attemptsRemaining
   */
  @NotNull
  @Valid
  @JsonProperty("attemptsRemaining")
  public BigDecimal getAttemptsRemaining() {
    return attemptsRemaining;
  }

  @JsonProperty("attemptsRemaining")
  public void setAttemptsRemaining(BigDecimal attemptsRemaining) {
    this.attemptsRemaining = attemptsRemaining;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OtpStatusResponseDto otpStatusResponseDto = (OtpStatusResponseDto) o;
    return (
      Objects.equals(this.pending, otpStatusResponseDto.pending) &&
      Objects.equals(this.target, otpStatusResponseDto.target) &&
      Objects.equals(this.expiresAt, otpStatusResponseDto.expiresAt) &&
      Objects.equals(
        this.attemptsRemaining,
        otpStatusResponseDto.attemptsRemaining
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(pending, target, expiresAt, attemptsRemaining);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OtpStatusResponseDto {\n");
    sb.append("    pending: ").append(toIndentedString(pending)).append("\n");
    sb.append("    target: ").append(toIndentedString(target)).append("\n");
    sb.append("    expiresAt: ")
      .append(toIndentedString(expiresAt))
      .append("\n");
    sb.append("    attemptsRemaining: ")
      .append(toIndentedString(attemptsRemaining))
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

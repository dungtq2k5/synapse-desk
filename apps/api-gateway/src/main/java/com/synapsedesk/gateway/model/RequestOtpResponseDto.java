package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * RequestOtpResponseDto
 */

public class RequestOtpResponseDto {

  private String target;

  private BigDecimal expiresInMinutes;

  public RequestOtpResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RequestOtpResponseDto(String target, BigDecimal expiresInMinutes) {
    this.target = target;
    this.expiresInMinutes = expiresInMinutes;
  }

  public RequestOtpResponseDto target(String target) {
    this.target = target;
    return this;
  }

  /**
   * Masked: `a***e@acme.com` or `+44******1234`.
   * @return target
   */
  @NotNull
  @JsonProperty("target")
  public String getTarget() {
    return target;
  }

  @JsonProperty("target")
  public void setTarget(String target) {
    this.target = target;
  }

  public RequestOtpResponseDto expiresInMinutes(BigDecimal expiresInMinutes) {
    this.expiresInMinutes = expiresInMinutes;
    return this;
  }

  /**
   * Get expiresInMinutes
   * @return expiresInMinutes
   */
  @NotNull
  @Valid
  @JsonProperty("expiresInMinutes")
  public BigDecimal getExpiresInMinutes() {
    return expiresInMinutes;
  }

  @JsonProperty("expiresInMinutes")
  public void setExpiresInMinutes(BigDecimal expiresInMinutes) {
    this.expiresInMinutes = expiresInMinutes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RequestOtpResponseDto requestOtpResponseDto = (RequestOtpResponseDto) o;
    return (
      Objects.equals(this.target, requestOtpResponseDto.target) &&
      Objects.equals(
        this.expiresInMinutes,
        requestOtpResponseDto.expiresInMinutes
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(target, expiresInMinutes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RequestOtpResponseDto {\n");
    sb.append("    target: ").append(toIndentedString(target)).append("\n");
    sb.append("    expiresInMinutes: ")
      .append(toIndentedString(expiresInMinutes))
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

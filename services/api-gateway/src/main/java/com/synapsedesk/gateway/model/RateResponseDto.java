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
 * RateResponseDto
 */

public class RateResponseDto {

  private BigDecimal rate = null;

  private BigDecimal numerator;

  private BigDecimal denominator;

  public RateResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RateResponseDto(
    BigDecimal rate,
    BigDecimal numerator,
    BigDecimal denominator
  ) {
    this.rate = rate;
    this.numerator = numerator;
    this.denominator = denominator;
  }

  public RateResponseDto rate(BigDecimal rate) {
    this.rate = rate;
    return this;
  }

  /**
   * null when the denominator is zero — NOT zero. The two are different facts.
   * @return rate
   */
  @Valid
  @JsonProperty("rate")
  public BigDecimal getRate() {
    return rate;
  }

  @JsonProperty("rate")
  public void setRate(BigDecimal rate) {
    this.rate = rate;
  }

  public RateResponseDto numerator(BigDecimal numerator) {
    this.numerator = numerator;
    return this;
  }

  /**
   * Get numerator
   * @return numerator
   */
  @NotNull
  @Valid
  @JsonProperty("numerator")
  public BigDecimal getNumerator() {
    return numerator;
  }

  @JsonProperty("numerator")
  public void setNumerator(BigDecimal numerator) {
    this.numerator = numerator;
  }

  public RateResponseDto denominator(BigDecimal denominator) {
    this.denominator = denominator;
    return this;
  }

  /**
   * Get denominator
   * @return denominator
   */
  @NotNull
  @Valid
  @JsonProperty("denominator")
  public BigDecimal getDenominator() {
    return denominator;
  }

  @JsonProperty("denominator")
  public void setDenominator(BigDecimal denominator) {
    this.denominator = denominator;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RateResponseDto rateResponseDto = (RateResponseDto) o;
    return (
      Objects.equals(this.rate, rateResponseDto.rate) &&
      Objects.equals(this.numerator, rateResponseDto.numerator) &&
      Objects.equals(this.denominator, rateResponseDto.denominator)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(rate, numerator, denominator);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RateResponseDto {\n");
    sb.append("    rate: ").append(toIndentedString(rate)).append("\n");
    sb.append("    numerator: ")
      .append(toIndentedString(numerator))
      .append("\n");
    sb.append("    denominator: ")
      .append(toIndentedString(denominator))
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

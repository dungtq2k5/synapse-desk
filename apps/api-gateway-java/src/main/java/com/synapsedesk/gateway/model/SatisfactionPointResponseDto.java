package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.RateResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SatisfactionPointResponseDto
 */

public class SatisfactionPointResponseDto {

  private String day;

  private RateResponseDto csat;

  private RateResponseDto citationAccuracy;

  public SatisfactionPointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SatisfactionPointResponseDto(
    String day,
    RateResponseDto csat,
    RateResponseDto citationAccuracy
  ) {
    this.day = day;
    this.csat = csat;
    this.citationAccuracy = citationAccuracy;
  }

  public SatisfactionPointResponseDto day(String day) {
    this.day = day;
    return this;
  }

  /**
   * Get day
   * @return day
   */
  @NotNull
  @JsonProperty("day")
  public String getDay() {
    return day;
  }

  @JsonProperty("day")
  public void setDay(String day) {
    this.day = day;
  }

  public SatisfactionPointResponseDto csat(RateResponseDto csat) {
    this.csat = csat;
    return this;
  }

  /**
   * Get csat
   * @return csat
   */
  @NotNull
  @Valid
  @JsonProperty("csat")
  public RateResponseDto getCsat() {
    return csat;
  }

  @JsonProperty("csat")
  public void setCsat(RateResponseDto csat) {
    this.csat = csat;
  }

  public SatisfactionPointResponseDto citationAccuracy(
    RateResponseDto citationAccuracy
  ) {
    this.citationAccuracy = citationAccuracy;
    return this;
  }

  /**
   * Get citationAccuracy
   * @return citationAccuracy
   */
  @NotNull
  @Valid
  @JsonProperty("citationAccuracy")
  public RateResponseDto getCitationAccuracy() {
    return citationAccuracy;
  }

  @JsonProperty("citationAccuracy")
  public void setCitationAccuracy(RateResponseDto citationAccuracy) {
    this.citationAccuracy = citationAccuracy;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SatisfactionPointResponseDto satisfactionPointResponseDto =
      (SatisfactionPointResponseDto) o;
    return (
      Objects.equals(this.day, satisfactionPointResponseDto.day) &&
      Objects.equals(this.csat, satisfactionPointResponseDto.csat) &&
      Objects.equals(
        this.citationAccuracy,
        satisfactionPointResponseDto.citationAccuracy
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(day, csat, citationAccuracy);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SatisfactionPointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    csat: ").append(toIndentedString(csat)).append("\n");
    sb.append("    citationAccuracy: ")
      .append(toIndentedString(citationAccuracy))
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

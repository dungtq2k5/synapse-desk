package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.RateResponseDto;
import com.synapsedesk.gateway.model.SatisfactionPointResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SatisfactionResponseDto
 */

public class SatisfactionResponseDto {

  private List<@Valid SatisfactionPointResponseDto> points = new ArrayList<>();

  private RateResponseDto csatTotal;

  private RateResponseDto citationAccuracyTotal;

  private String dataThrough = null;

  public SatisfactionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SatisfactionResponseDto(
    List<@Valid SatisfactionPointResponseDto> points,
    RateResponseDto csatTotal,
    RateResponseDto citationAccuracyTotal,
    String dataThrough
  ) {
    this.points = points;
    this.csatTotal = csatTotal;
    this.citationAccuracyTotal = citationAccuracyTotal;
    this.dataThrough = dataThrough;
  }

  public SatisfactionResponseDto points(
    List<@Valid SatisfactionPointResponseDto> points
  ) {
    this.points = points;
    return this;
  }

  public SatisfactionResponseDto addPointsItem(
    SatisfactionPointResponseDto pointsItem
  ) {
    if (this.points == null) {
      this.points = new ArrayList<>();
    }
    this.points.add(pointsItem);
    return this;
  }

  /**
   * Get points
   * @return points
   */
  @NotNull
  @Valid
  @JsonProperty("points")
  public List<@Valid SatisfactionPointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid SatisfactionPointResponseDto> points) {
    this.points = points;
  }

  public SatisfactionResponseDto csatTotal(RateResponseDto csatTotal) {
    this.csatTotal = csatTotal;
    return this;
  }

  /**
   * Get csatTotal
   * @return csatTotal
   */
  @NotNull
  @Valid
  @JsonProperty("csatTotal")
  public RateResponseDto getCsatTotal() {
    return csatTotal;
  }

  @JsonProperty("csatTotal")
  public void setCsatTotal(RateResponseDto csatTotal) {
    this.csatTotal = csatTotal;
  }

  public SatisfactionResponseDto citationAccuracyTotal(
    RateResponseDto citationAccuracyTotal
  ) {
    this.citationAccuracyTotal = citationAccuracyTotal;
    return this;
  }

  /**
   * Get citationAccuracyTotal
   * @return citationAccuracyTotal
   */
  @NotNull
  @Valid
  @JsonProperty("citationAccuracyTotal")
  public RateResponseDto getCitationAccuracyTotal() {
    return citationAccuracyTotal;
  }

  @JsonProperty("citationAccuracyTotal")
  public void setCitationAccuracyTotal(RateResponseDto citationAccuracyTotal) {
    this.citationAccuracyTotal = citationAccuracyTotal;
  }

  public SatisfactionResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * See `OverviewResponseDto.dataThrough`.
   * @return dataThrough
   */

  @JsonProperty("dataThrough")
  public String getDataThrough() {
    return dataThrough;
  }

  @JsonProperty("dataThrough")
  public void setDataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SatisfactionResponseDto satisfactionResponseDto =
      (SatisfactionResponseDto) o;
    return (
      Objects.equals(this.points, satisfactionResponseDto.points) &&
      Objects.equals(this.csatTotal, satisfactionResponseDto.csatTotal) &&
      Objects.equals(
        this.citationAccuracyTotal,
        satisfactionResponseDto.citationAccuracyTotal
      ) &&
      Objects.equals(this.dataThrough, satisfactionResponseDto.dataThrough)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(points, csatTotal, citationAccuracyTotal, dataThrough);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SatisfactionResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    csatTotal: ")
      .append(toIndentedString(csatTotal))
      .append("\n");
    sb.append("    citationAccuracyTotal: ")
      .append(toIndentedString(citationAccuracyTotal))
      .append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
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

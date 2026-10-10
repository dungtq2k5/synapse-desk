package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.DeflectionPointResponseDto;
import com.synapsedesk.gateway.model.RateResponseDto;
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
 * DeflectionResponseDto
 */

public class DeflectionResponseDto {

  private List<@Valid DeflectionPointResponseDto> points = new ArrayList<>();

  private RateResponseDto total;

  private String dataThrough = null;

  public DeflectionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeflectionResponseDto(
    List<@Valid DeflectionPointResponseDto> points,
    RateResponseDto total,
    String dataThrough
  ) {
    this.points = points;
    this.total = total;
    this.dataThrough = dataThrough;
  }

  public DeflectionResponseDto points(
    List<@Valid DeflectionPointResponseDto> points
  ) {
    this.points = points;
    return this;
  }

  public DeflectionResponseDto addPointsItem(
    DeflectionPointResponseDto pointsItem
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
  public List<@Valid DeflectionPointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid DeflectionPointResponseDto> points) {
    this.points = points;
  }

  public DeflectionResponseDto total(RateResponseDto total) {
    this.total = total;
    return this;
  }

  /**
   * Get total
   * @return total
   */
  @NotNull
  @Valid
  @JsonProperty("total")
  public RateResponseDto getTotal() {
    return total;
  }

  @JsonProperty("total")
  public void setTotal(RateResponseDto total) {
    this.total = total;
  }

  public DeflectionResponseDto dataThrough(String dataThrough) {
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
    DeflectionResponseDto deflectionResponseDto = (DeflectionResponseDto) o;
    return (
      Objects.equals(this.points, deflectionResponseDto.points) &&
      Objects.equals(this.total, deflectionResponseDto.total) &&
      Objects.equals(this.dataThrough, deflectionResponseDto.dataThrough)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(points, total, dataThrough);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeflectionResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    total: ").append(toIndentedString(total)).append("\n");
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

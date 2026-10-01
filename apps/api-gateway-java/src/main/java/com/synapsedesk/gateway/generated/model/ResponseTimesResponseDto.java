package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.MeanResponseDto;
import com.synapsedesk.gateway.generated.model.ResponseTimePointResponseDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * ResponseTimesResponseDto
 */

public class ResponseTimesResponseDto {

  private List<@Valid ResponseTimePointResponseDto> points = new ArrayList<>();

  private MeanResponseDto humanTotal;

  private MeanResponseDto aiTotal;

  private MeanResponseDto resolutionTotal;

  private String dataThrough = null;

  public ResponseTimesResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ResponseTimesResponseDto(List<@Valid ResponseTimePointResponseDto> points, MeanResponseDto humanTotal, MeanResponseDto aiTotal, MeanResponseDto resolutionTotal, String dataThrough) {
    this.points = points;
    this.humanTotal = humanTotal;
    this.aiTotal = aiTotal;
    this.resolutionTotal = resolutionTotal;
    this.dataThrough = dataThrough;
  }

  public ResponseTimesResponseDto points(List<@Valid ResponseTimePointResponseDto> points) {
    this.points = points;
    return this;
  }

  public ResponseTimesResponseDto addPointsItem(ResponseTimePointResponseDto pointsItem) {
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
  @NotNull @Valid 
  @JsonProperty("points")
  public List<@Valid ResponseTimePointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid ResponseTimePointResponseDto> points) {
    this.points = points;
  }

  public ResponseTimesResponseDto humanTotal(MeanResponseDto humanTotal) {
    this.humanTotal = humanTotal;
    return this;
  }

  /**
   * Get humanTotal
   * @return humanTotal
   */
  @NotNull @Valid 
  @JsonProperty("humanTotal")
  public MeanResponseDto getHumanTotal() {
    return humanTotal;
  }

  @JsonProperty("humanTotal")
  public void setHumanTotal(MeanResponseDto humanTotal) {
    this.humanTotal = humanTotal;
  }

  public ResponseTimesResponseDto aiTotal(MeanResponseDto aiTotal) {
    this.aiTotal = aiTotal;
    return this;
  }

  /**
   * Get aiTotal
   * @return aiTotal
   */
  @NotNull @Valid 
  @JsonProperty("aiTotal")
  public MeanResponseDto getAiTotal() {
    return aiTotal;
  }

  @JsonProperty("aiTotal")
  public void setAiTotal(MeanResponseDto aiTotal) {
    this.aiTotal = aiTotal;
  }

  public ResponseTimesResponseDto resolutionTotal(MeanResponseDto resolutionTotal) {
    this.resolutionTotal = resolutionTotal;
    return this;
  }

  /**
   * Get resolutionTotal
   * @return resolutionTotal
   */
  @NotNull @Valid 
  @JsonProperty("resolutionTotal")
  public MeanResponseDto getResolutionTotal() {
    return resolutionTotal;
  }

  @JsonProperty("resolutionTotal")
  public void setResolutionTotal(MeanResponseDto resolutionTotal) {
    this.resolutionTotal = resolutionTotal;
  }

  public ResponseTimesResponseDto dataThrough(String dataThrough) {
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
    ResponseTimesResponseDto responseTimesResponseDto = (ResponseTimesResponseDto) o;
    return Objects.equals(this.points, responseTimesResponseDto.points) &&
        Objects.equals(this.humanTotal, responseTimesResponseDto.humanTotal) &&
        Objects.equals(this.aiTotal, responseTimesResponseDto.aiTotal) &&
        Objects.equals(this.resolutionTotal, responseTimesResponseDto.resolutionTotal) &&
        Objects.equals(this.dataThrough, responseTimesResponseDto.dataThrough);
  }

  @Override
  public int hashCode() {
    return Objects.hash(points, humanTotal, aiTotal, resolutionTotal, dataThrough);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ResponseTimesResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    humanTotal: ").append(toIndentedString(humanTotal)).append("\n");
    sb.append("    aiTotal: ").append(toIndentedString(aiTotal)).append("\n");
    sb.append("    resolutionTotal: ").append(toIndentedString(resolutionTotal)).append("\n");
    sb.append("    dataThrough: ").append(toIndentedString(dataThrough)).append("\n");
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


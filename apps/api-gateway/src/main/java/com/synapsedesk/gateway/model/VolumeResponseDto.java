package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.VolumeBreakdownResponseDto;
import com.synapsedesk.gateway.model.VolumePointResponseDto;
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
 * VolumeResponseDto
 */

public class VolumeResponseDto {

  private List<@Valid VolumePointResponseDto> points = new ArrayList<>();

  private List<@Valid VolumeBreakdownResponseDto> byStatus = new ArrayList<>();

  private List<@Valid VolumeBreakdownResponseDto> byPriority =
    new ArrayList<>();

  private List<@Valid VolumeBreakdownResponseDto> bySource = new ArrayList<>();

  private String dataThrough = null;

  public VolumeResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public VolumeResponseDto(
    List<@Valid VolumePointResponseDto> points,
    List<@Valid VolumeBreakdownResponseDto> byStatus,
    List<@Valid VolumeBreakdownResponseDto> byPriority,
    List<@Valid VolumeBreakdownResponseDto> bySource,
    String dataThrough
  ) {
    this.points = points;
    this.byStatus = byStatus;
    this.byPriority = byPriority;
    this.bySource = bySource;
    this.dataThrough = dataThrough;
  }

  public VolumeResponseDto points(List<@Valid VolumePointResponseDto> points) {
    this.points = points;
    return this;
  }

  public VolumeResponseDto addPointsItem(VolumePointResponseDto pointsItem) {
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
  public List<@Valid VolumePointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid VolumePointResponseDto> points) {
    this.points = points;
  }

  public VolumeResponseDto byStatus(
    List<@Valid VolumeBreakdownResponseDto> byStatus
  ) {
    this.byStatus = byStatus;
    return this;
  }

  public VolumeResponseDto addByStatusItem(
    VolumeBreakdownResponseDto byStatusItem
  ) {
    if (this.byStatus == null) {
      this.byStatus = new ArrayList<>();
    }
    this.byStatus.add(byStatusItem);
    return this;
  }

  /**
   * Get byStatus
   * @return byStatus
   */
  @NotNull
  @Valid
  @JsonProperty("byStatus")
  public List<@Valid VolumeBreakdownResponseDto> getByStatus() {
    return byStatus;
  }

  @JsonProperty("byStatus")
  public void setByStatus(List<@Valid VolumeBreakdownResponseDto> byStatus) {
    this.byStatus = byStatus;
  }

  public VolumeResponseDto byPriority(
    List<@Valid VolumeBreakdownResponseDto> byPriority
  ) {
    this.byPriority = byPriority;
    return this;
  }

  public VolumeResponseDto addByPriorityItem(
    VolumeBreakdownResponseDto byPriorityItem
  ) {
    if (this.byPriority == null) {
      this.byPriority = new ArrayList<>();
    }
    this.byPriority.add(byPriorityItem);
    return this;
  }

  /**
   * Get byPriority
   * @return byPriority
   */
  @NotNull
  @Valid
  @JsonProperty("byPriority")
  public List<@Valid VolumeBreakdownResponseDto> getByPriority() {
    return byPriority;
  }

  @JsonProperty("byPriority")
  public void setByPriority(
    List<@Valid VolumeBreakdownResponseDto> byPriority
  ) {
    this.byPriority = byPriority;
  }

  public VolumeResponseDto bySource(
    List<@Valid VolumeBreakdownResponseDto> bySource
  ) {
    this.bySource = bySource;
    return this;
  }

  public VolumeResponseDto addBySourceItem(
    VolumeBreakdownResponseDto bySourceItem
  ) {
    if (this.bySource == null) {
      this.bySource = new ArrayList<>();
    }
    this.bySource.add(bySourceItem);
    return this;
  }

  /**
   * Get bySource
   * @return bySource
   */
  @NotNull
  @Valid
  @JsonProperty("bySource")
  public List<@Valid VolumeBreakdownResponseDto> getBySource() {
    return bySource;
  }

  @JsonProperty("bySource")
  public void setBySource(List<@Valid VolumeBreakdownResponseDto> bySource) {
    this.bySource = bySource;
  }

  public VolumeResponseDto dataThrough(String dataThrough) {
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
    VolumeResponseDto volumeResponseDto = (VolumeResponseDto) o;
    return (
      Objects.equals(this.points, volumeResponseDto.points) &&
      Objects.equals(this.byStatus, volumeResponseDto.byStatus) &&
      Objects.equals(this.byPriority, volumeResponseDto.byPriority) &&
      Objects.equals(this.bySource, volumeResponseDto.bySource) &&
      Objects.equals(this.dataThrough, volumeResponseDto.dataThrough)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(points, byStatus, byPriority, bySource, dataThrough);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class VolumeResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    byStatus: ").append(toIndentedString(byStatus)).append("\n");
    sb.append("    byPriority: ")
      .append(toIndentedString(byPriority))
      .append("\n");
    sb.append("    bySource: ").append(toIndentedString(bySource)).append("\n");
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

package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.JobRunStatusResponseDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * JobHealthResponseDto
 */

public class JobHealthResponseDto {

  private List<@Valid JobRunStatusResponseDto> items = new ArrayList<>();

  private Boolean degraded;

  private List<String> unavailable = new ArrayList<>();

  public JobHealthResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public JobHealthResponseDto(List<@Valid JobRunStatusResponseDto> items, Boolean degraded, List<String> unavailable) {
    this.items = items;
    this.degraded = degraded;
    this.unavailable = unavailable;
  }

  public JobHealthResponseDto items(List<@Valid JobRunStatusResponseDto> items) {
    this.items = items;
    return this;
  }

  public JobHealthResponseDto addItemsItem(JobRunStatusResponseDto itemsItem) {
    if (this.items == null) {
      this.items = new ArrayList<>();
    }
    this.items.add(itemsItem);
    return this;
  }

  /**
   * Get items
   * @return items
   */
  @NotNull @Valid 
  @JsonProperty("items")
  public List<@Valid JobRunStatusResponseDto> getItems() {
    return items;
  }

  @JsonProperty("items")
  public void setItems(List<@Valid JobRunStatusResponseDto> items) {
    this.items = items;
  }

  public JobHealthResponseDto degraded(Boolean degraded) {
    this.degraded = degraded;
    return this;
  }

  /**
   * True when ANY expected job is unhealthy — the single field a monitor can alert on without knowing the job list.
   * @return degraded
   */
  @NotNull 
  @JsonProperty("degraded")
  public Boolean getDegraded() {
    return degraded;
  }

  @JsonProperty("degraded")
  public void setDegraded(Boolean degraded) {
    this.degraded = degraded;
  }

  public JobHealthResponseDto unavailable(List<String> unavailable) {
    this.unavailable = unavailable;
    return this;
  }

  public JobHealthResponseDto addUnavailableItem(String unavailableItem) {
    if (this.unavailable == null) {
      this.unavailable = new ArrayList<>();
    }
    this.unavailable.add(unavailableItem);
    return this;
  }

  /**
   * Which legs could not be reached, so a partial answer is legible as one.
   * @return unavailable
   */
  @NotNull 
  @JsonProperty("unavailable")
  public List<String> getUnavailable() {
    return unavailable;
  }

  @JsonProperty("unavailable")
  public void setUnavailable(List<String> unavailable) {
    this.unavailable = unavailable;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    JobHealthResponseDto jobHealthResponseDto = (JobHealthResponseDto) o;
    return Objects.equals(this.items, jobHealthResponseDto.items) &&
        Objects.equals(this.degraded, jobHealthResponseDto.degraded) &&
        Objects.equals(this.unavailable, jobHealthResponseDto.unavailable);
  }

  @Override
  public int hashCode() {
    return Objects.hash(items, degraded, unavailable);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class JobHealthResponseDto {\n");
    sb.append("    items: ").append(toIndentedString(items)).append("\n");
    sb.append("    degraded: ").append(toIndentedString(degraded)).append("\n");
    sb.append("    unavailable: ").append(toIndentedString(unavailable)).append("\n");
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


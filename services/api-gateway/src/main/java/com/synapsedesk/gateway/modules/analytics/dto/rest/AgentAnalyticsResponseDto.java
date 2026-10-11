package com.synapsedesk.gateway.modules.analytics.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.analytics.dto.rest.AgentStatResponseDto;
import com.synapsedesk.gateway.modules.analytics.dto.rest.UnavailableBlockResponseDto;
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
 * AgentAnalyticsResponseDto
 */

public class AgentAnalyticsResponseDto {

  private List<@Valid AgentStatResponseDto> items = new ArrayList<>();

  private String dataThrough = null;

  private List<@Valid UnavailableBlockResponseDto> unavailable =
    new ArrayList<>();

  public AgentAnalyticsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AgentAnalyticsResponseDto(
    List<@Valid AgentStatResponseDto> items,
    String dataThrough,
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.items = items;
    this.dataThrough = dataThrough;
    this.unavailable = unavailable;
  }

  public AgentAnalyticsResponseDto items(
    List<@Valid AgentStatResponseDto> items
  ) {
    this.items = items;
    return this;
  }

  public AgentAnalyticsResponseDto addItemsItem(
    AgentStatResponseDto itemsItem
  ) {
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
  @NotNull
  @Valid
  @JsonProperty("items")
  public List<@Valid AgentStatResponseDto> getItems() {
    return items;
  }

  @JsonProperty("items")
  public void setItems(List<@Valid AgentStatResponseDto> items) {
    this.items = items;
  }

  public AgentAnalyticsResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * **The last day the underlying rollups cover**, `YYYY-MM-DD`, or `null` when nothing has ever been rolled up.  This endpoint spans more than one service, so it reports the STALEST leg: a composed answer is only as fresh as its oldest input, and reporting the freshest would let one healthy service vouch for a broken one.
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

  public AgentAnalyticsResponseDto unavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.unavailable = unavailable;
    return this;
  }

  public AgentAnalyticsResponseDto addUnavailableItem(
    UnavailableBlockResponseDto unavailableItem
  ) {
    if (this.unavailable == null) {
      this.unavailable = new ArrayList<>();
    }
    this.unavailable.add(unavailableItem);
    return this;
  }

  /**
   * Which legs could not be reached. Empty when everything answered.
   * @return unavailable
   */
  @NotNull
  @Valid
  @JsonProperty("unavailable")
  public List<@Valid UnavailableBlockResponseDto> getUnavailable() {
    return unavailable;
  }

  @JsonProperty("unavailable")
  public void setUnavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
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
    AgentAnalyticsResponseDto agentAnalyticsResponseDto =
      (AgentAnalyticsResponseDto) o;
    return (
      Objects.equals(this.items, agentAnalyticsResponseDto.items) &&
      Objects.equals(this.dataThrough, agentAnalyticsResponseDto.dataThrough) &&
      Objects.equals(this.unavailable, agentAnalyticsResponseDto.unavailable)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(items, dataThrough, unavailable);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AgentAnalyticsResponseDto {\n");
    sb.append("    items: ").append(toIndentedString(items)).append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
      .append("\n");
    sb.append("    unavailable: ")
      .append(toIndentedString(unavailable))
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

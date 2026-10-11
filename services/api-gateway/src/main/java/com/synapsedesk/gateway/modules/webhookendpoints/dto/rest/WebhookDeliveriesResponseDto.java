package com.synapsedesk.gateway.modules.webhookendpoints.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.webhookendpoints.dto.rest.WebhookDeliveryResponseDto;
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
 * WebhookDeliveriesResponseDto
 */

public class WebhookDeliveriesResponseDto {

  private List<@Valid WebhookDeliveryResponseDto> items = new ArrayList<>();

  public WebhookDeliveriesResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public WebhookDeliveriesResponseDto(
    List<@Valid WebhookDeliveryResponseDto> items
  ) {
    this.items = items;
  }

  public WebhookDeliveriesResponseDto items(
    List<@Valid WebhookDeliveryResponseDto> items
  ) {
    this.items = items;
    return this;
  }

  public WebhookDeliveriesResponseDto addItemsItem(
    WebhookDeliveryResponseDto itemsItem
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
  public List<@Valid WebhookDeliveryResponseDto> getItems() {
    return items;
  }

  @JsonProperty("items")
  public void setItems(List<@Valid WebhookDeliveryResponseDto> items) {
    this.items = items;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    WebhookDeliveriesResponseDto webhookDeliveriesResponseDto =
      (WebhookDeliveriesResponseDto) o;
    return Objects.equals(this.items, webhookDeliveriesResponseDto.items);
  }

  @Override
  public int hashCode() {
    return Objects.hash(items);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class WebhookDeliveriesResponseDto {\n");
    sb.append("    items: ").append(toIndentedString(items)).append("\n");
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

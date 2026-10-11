package com.synapsedesk.gateway.modules.webhookendpoints.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UpdateWebhookEndpointDto
 */

public class UpdateWebhookEndpointDto {

  private @Nullable URI url;

  private @Nullable String description;

  /**
   * Gets or Sets eventTypes
   */
  public enum EventTypesEnum {
    BILLING_PAYMENT_FAILED("billing.payment_failed"),

    BILLING_PLAN_CHANGED("billing.plan_changed"),

    LIMIT_THRESHOLD("limit.threshold"),

    QUOTA_THRESHOLD("quota.threshold"),

    TICKET_ASSIGNED("ticket.assigned"),

    TICKET_ESCALATED("ticket.escalated"),

    TICKET_MESSAGE_CREATED("ticket.message_created"),

    TICKET_REASSIGNED("ticket.reassigned"),

    TICKET_STATUS_CHANGED("ticket.status_changed"),

    WEBHOOK_ENDPOINT_DISABLED("webhook.endpoint_disabled");

    private final String value;

    EventTypesEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static EventTypesEnum fromValue(String value) {
      for (EventTypesEnum b : EventTypesEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private List<EventTypesEnum> eventTypes;

  private @Nullable Boolean isActive;

  public UpdateWebhookEndpointDto url(@Nullable URI url) {
    this.url = url;
    return this;
  }

  /**
   * Get url
   * @return url
   */
  @Valid
  @Size(max = 2000)
  @JsonProperty("url")
  public @Nullable URI getUrl() {
    return url;
  }

  @JsonProperty("url")
  public void setUrl(@Nullable URI url) {
    this.url = url;
  }

  public UpdateWebhookEndpointDto description(@Nullable String description) {
    this.description = description;
    return this;
  }

  /**
   * Get description
   * @return description
   */
  @Size(max = 500)
  @JsonProperty("description")
  public @Nullable String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(@Nullable String description) {
    this.description = description;
  }

  public UpdateWebhookEndpointDto eventTypes(List<EventTypesEnum> eventTypes) {
    this.eventTypes = eventTypes;
    return this;
  }

  public UpdateWebhookEndpointDto addEventTypesItem(
    EventTypesEnum eventTypesItem
  ) {
    if (this.eventTypes == null) {
      this.eventTypes = new ArrayList<>();
    }
    this.eventTypes.add(eventTypesItem);
    return this;
  }

  /**
   * Absent means \"leave them\"; an empty array is refused, same as create.
   * @return eventTypes
   */
  @Size(min = 1)
  @JsonProperty("eventTypes")
  public List<EventTypesEnum> getEventTypes() {
    return eventTypes;
  }

  @JsonProperty("eventTypes")
  public void setEventTypes(List<EventTypesEnum> eventTypes) {
    this.eventTypes = eventTypes;
  }

  public UpdateWebhookEndpointDto isActive(@Nullable Boolean isActive) {
    this.isActive = isActive;
    return this;
  }

  /**
   * Get isActive
   * @return isActive
   */

  @JsonProperty("isActive")
  public @Nullable Boolean getIsActive() {
    return isActive;
  }

  @JsonProperty("isActive")
  public void setIsActive(@Nullable Boolean isActive) {
    this.isActive = isActive;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateWebhookEndpointDto updateWebhookEndpointDto =
      (UpdateWebhookEndpointDto) o;
    return (
      Objects.equals(this.url, updateWebhookEndpointDto.url) &&
      Objects.equals(this.description, updateWebhookEndpointDto.description) &&
      Objects.equals(this.eventTypes, updateWebhookEndpointDto.eventTypes) &&
      Objects.equals(this.isActive, updateWebhookEndpointDto.isActive)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(url, description, eventTypes, isActive);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateWebhookEndpointDto {\n");
    sb.append("    url: ").append(toIndentedString(url)).append("\n");
    sb.append("    description: ")
      .append(toIndentedString(description))
      .append("\n");
    sb.append("    eventTypes: ")
      .append(toIndentedString(eventTypes))
      .append("\n");
    sb.append("    isActive: ").append(toIndentedString(isActive)).append("\n");
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

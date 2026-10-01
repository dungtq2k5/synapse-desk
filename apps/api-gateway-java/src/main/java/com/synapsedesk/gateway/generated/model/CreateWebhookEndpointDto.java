package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * CreateWebhookEndpointDto
 */

public class CreateWebhookEndpointDto {

  private URI url;

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

  private List<EventTypesEnum> eventTypes = new ArrayList<>();

  public CreateWebhookEndpointDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateWebhookEndpointDto(URI url, List<EventTypesEnum> eventTypes) {
    this.url = url;
    this.eventTypes = eventTypes;
  }

  public CreateWebhookEndpointDto url(URI url) {
    this.url = url;
    return this;
  }

  /**
   * Get url
   * @return url
   */
  @NotNull @Valid @Size(max = 2000) 
  @JsonProperty("url")
  public URI getUrl() {
    return url;
  }

  @JsonProperty("url")
  public void setUrl(URI url) {
    this.url = url;
  }

  public CreateWebhookEndpointDto description(@Nullable String description) {
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

  public CreateWebhookEndpointDto eventTypes(List<EventTypesEnum> eventTypes) {
    this.eventTypes = eventTypes;
    return this;
  }

  public CreateWebhookEndpointDto addEventTypesItem(EventTypesEnum eventTypesItem) {
    if (this.eventTypes == null) {
      this.eventTypes = new ArrayList<>();
    }
    this.eventTypes.add(eventTypesItem);
    return this;
  }

  /**
   * At least one — an endpoint subscribed to nothing is refused at creation, never created silently useless, and an empty list never means \"all\".
   * @return eventTypes
   */
  @NotNull @Size(min = 1) 
  @JsonProperty("eventTypes")
  public List<EventTypesEnum> getEventTypes() {
    return eventTypes;
  }

  @JsonProperty("eventTypes")
  public void setEventTypes(List<EventTypesEnum> eventTypes) {
    this.eventTypes = eventTypes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateWebhookEndpointDto createWebhookEndpointDto = (CreateWebhookEndpointDto) o;
    return Objects.equals(this.url, createWebhookEndpointDto.url) &&
        Objects.equals(this.description, createWebhookEndpointDto.description) &&
        Objects.equals(this.eventTypes, createWebhookEndpointDto.eventTypes);
  }

  @Override
  public int hashCode() {
    return Objects.hash(url, description, eventTypes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateWebhookEndpointDto {\n");
    sb.append("    url: ").append(toIndentedString(url)).append("\n");
    sb.append("    description: ").append(toIndentedString(description)).append("\n");
    sb.append("    eventTypes: ").append(toIndentedString(eventTypes)).append("\n");
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


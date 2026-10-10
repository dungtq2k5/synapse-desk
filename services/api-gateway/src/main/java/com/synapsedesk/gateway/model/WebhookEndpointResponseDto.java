package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * WebhookEndpointResponseDto
 */

public class WebhookEndpointResponseDto {

  private String id;

  private String url;

  private String description = null;

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

  private Boolean isActive;

  private String disabledReason = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public WebhookEndpointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public WebhookEndpointResponseDto(
    String id,
    String url,
    String description,
    List<EventTypesEnum> eventTypes,
    Boolean isActive,
    String disabledReason,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
  ) {
    this.id = id;
    this.url = url;
    this.description = description;
    this.eventTypes = eventTypes;
    this.isActive = isActive;
    this.disabledReason = disabledReason;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public WebhookEndpointResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public WebhookEndpointResponseDto url(String url) {
    this.url = url;
    return this;
  }

  /**
   * Get url
   * @return url
   */
  @NotNull
  @JsonProperty("url")
  public String getUrl() {
    return url;
  }

  @JsonProperty("url")
  public void setUrl(String url) {
    this.url = url;
  }

  public WebhookEndpointResponseDto description(String description) {
    this.description = description;
    return this;
  }

  /**
   * Get description
   * @return description
   */

  @JsonProperty("description")
  public String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(String description) {
    this.description = description;
  }

  public WebhookEndpointResponseDto eventTypes(
    List<EventTypesEnum> eventTypes
  ) {
    this.eventTypes = eventTypes;
    return this;
  }

  public WebhookEndpointResponseDto addEventTypesItem(
    EventTypesEnum eventTypesItem
  ) {
    if (this.eventTypes == null) {
      this.eventTypes = new ArrayList<>();
    }
    this.eventTypes.add(eventTypesItem);
    return this;
  }

  /**
   * The `NotificationType` vocabulary (`ticket.assigned`) — the public event names, never the internal transport subjects. **Never empty**: an empty list never means \"all\", and zero subscriptions is refused at creation.
   * @return eventTypes
   */
  @NotNull
  @JsonProperty("eventTypes")
  public List<EventTypesEnum> getEventTypes() {
    return eventTypes;
  }

  @JsonProperty("eventTypes")
  public void setEventTypes(List<EventTypesEnum> eventTypes) {
    this.eventTypes = eventTypes;
  }

  public WebhookEndpointResponseDto isActive(Boolean isActive) {
    this.isActive = isActive;
    return this;
  }

  /**
   * Get isActive
   * @return isActive
   */
  @NotNull
  @JsonProperty("isActive")
  public Boolean getIsActive() {
    return isActive;
  }

  @JsonProperty("isActive")
  public void setIsActive(Boolean isActive) {
    this.isActive = isActive;
  }

  public WebhookEndpointResponseDto disabledReason(String disabledReason) {
    this.disabledReason = disabledReason;
    return this;
  }

  /**
   * Why WE disabled it (auto-disable after sustained failure). NULL when the tenant disabled it themselves — the distinction a settings page renders.
   * @return disabledReason
   */

  @JsonProperty("disabledReason")
  public String getDisabledReason() {
    return disabledReason;
  }

  @JsonProperty("disabledReason")
  public void setDisabledReason(String disabledReason) {
    this.disabledReason = disabledReason;
  }

  public WebhookEndpointResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public WebhookEndpointResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    WebhookEndpointResponseDto webhookEndpointResponseDto =
      (WebhookEndpointResponseDto) o;
    return (
      Objects.equals(this.id, webhookEndpointResponseDto.id) &&
      Objects.equals(this.url, webhookEndpointResponseDto.url) &&
      Objects.equals(
        this.description,
        webhookEndpointResponseDto.description
      ) &&
      Objects.equals(this.eventTypes, webhookEndpointResponseDto.eventTypes) &&
      Objects.equals(this.isActive, webhookEndpointResponseDto.isActive) &&
      Objects.equals(
        this.disabledReason,
        webhookEndpointResponseDto.disabledReason
      ) &&
      Objects.equals(this.createdAt, webhookEndpointResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, webhookEndpointResponseDto.updatedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      url,
      description,
      eventTypes,
      isActive,
      disabledReason,
      createdAt,
      updatedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class WebhookEndpointResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    url: ").append(toIndentedString(url)).append("\n");
    sb.append("    description: ")
      .append(toIndentedString(description))
      .append("\n");
    sb.append("    eventTypes: ")
      .append(toIndentedString(eventTypes))
      .append("\n");
    sb.append("    isActive: ").append(toIndentedString(isActive)).append("\n");
    sb.append("    disabledReason: ")
      .append(toIndentedString(disabledReason))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
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

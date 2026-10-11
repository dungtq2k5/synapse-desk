package com.synapsedesk.gateway.modules.webhookendpoints.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * WebhookDeliveryResponseDto
 */

public class WebhookDeliveryResponseDto {

  private String id;

  private String eventId;

  private String eventType;

  /**
   * `null` for a wire value this build does not know — never invented.
   */
  public enum StatusEnum {
    DELIVERED("DELIVERED"),

    FAILED("FAILED"),

    PENDING("PENDING");

    private final String value;

    StatusEnum(String value) {
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
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private StatusEnum status = null;

  private BigDecimal attempts;

  private BigDecimal responseStatus = null;

  private String lastError = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime occurredAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deliveredAt = null;

  public WebhookDeliveryResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public WebhookDeliveryResponseDto(
    String id,
    String eventId,
    String eventType,
    StatusEnum status,
    BigDecimal attempts,
    BigDecimal responseStatus,
    String lastError,
    OffsetDateTime occurredAt,
    OffsetDateTime deliveredAt
  ) {
    this.id = id;
    this.eventId = eventId;
    this.eventType = eventType;
    this.status = status;
    this.attempts = attempts;
    this.responseStatus = responseStatus;
    this.lastError = lastError;
    this.occurredAt = occurredAt;
    this.deliveredAt = deliveredAt;
  }

  public WebhookDeliveryResponseDto id(String id) {
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

  public WebhookDeliveryResponseDto eventId(String eventId) {
    this.eventId = eventId;
    return this;
  }

  /**
   * The payload `id` the receiver deduplicates on — stable across retries.
   * @return eventId
   */
  @NotNull
  @JsonProperty("eventId")
  public String getEventId() {
    return eventId;
  }

  @JsonProperty("eventId")
  public void setEventId(String eventId) {
    this.eventId = eventId;
  }

  public WebhookDeliveryResponseDto eventType(String eventType) {
    this.eventType = eventType;
    return this;
  }

  /**
   * Get eventType
   * @return eventType
   */
  @NotNull
  @JsonProperty("eventType")
  public String getEventType() {
    return eventType;
  }

  @JsonProperty("eventType")
  public void setEventType(String eventType) {
    this.eventType = eventType;
  }

  public WebhookDeliveryResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `null` for a wire value this build does not know — never invented.
   * @return status
   */

  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public WebhookDeliveryResponseDto attempts(BigDecimal attempts) {
    this.attempts = attempts;
    return this;
  }

  /**
   * Get attempts
   * @return attempts
   */
  @NotNull
  @Valid
  @JsonProperty("attempts")
  public BigDecimal getAttempts() {
    return attempts;
  }

  @JsonProperty("attempts")
  public void setAttempts(BigDecimal attempts) {
    this.attempts = attempts;
  }

  public WebhookDeliveryResponseDto responseStatus(BigDecimal responseStatus) {
    this.responseStatus = responseStatus;
    return this;
  }

  /**
   * Get responseStatus
   * @return responseStatus
   */
  @Valid
  @JsonProperty("responseStatus")
  public BigDecimal getResponseStatus() {
    return responseStatus;
  }

  @JsonProperty("responseStatus")
  public void setResponseStatus(BigDecimal responseStatus) {
    this.responseStatus = responseStatus;
  }

  public WebhookDeliveryResponseDto lastError(String lastError) {
    this.lastError = lastError;
    return this;
  }

  /**
   * Get lastError
   * @return lastError
   */

  @JsonProperty("lastError")
  public String getLastError() {
    return lastError;
  }

  @JsonProperty("lastError")
  public void setLastError(String lastError) {
    this.lastError = lastError;
  }

  public WebhookDeliveryResponseDto occurredAt(OffsetDateTime occurredAt) {
    this.occurredAt = occurredAt;
    return this;
  }

  /**
   * When the EVENT occurred — not when any attempt was made.
   * @return occurredAt
   */
  @NotNull
  @Valid
  @JsonProperty("occurredAt")
  public OffsetDateTime getOccurredAt() {
    return occurredAt;
  }

  @JsonProperty("occurredAt")
  public void setOccurredAt(OffsetDateTime occurredAt) {
    this.occurredAt = occurredAt;
  }

  public WebhookDeliveryResponseDto deliveredAt(OffsetDateTime deliveredAt) {
    this.deliveredAt = deliveredAt;
    return this;
  }

  /**
   * Get deliveredAt
   * @return deliveredAt
   */
  @Valid
  @JsonProperty("deliveredAt")
  public OffsetDateTime getDeliveredAt() {
    return deliveredAt;
  }

  @JsonProperty("deliveredAt")
  public void setDeliveredAt(OffsetDateTime deliveredAt) {
    this.deliveredAt = deliveredAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    WebhookDeliveryResponseDto webhookDeliveryResponseDto =
      (WebhookDeliveryResponseDto) o;
    return (
      Objects.equals(this.id, webhookDeliveryResponseDto.id) &&
      Objects.equals(this.eventId, webhookDeliveryResponseDto.eventId) &&
      Objects.equals(this.eventType, webhookDeliveryResponseDto.eventType) &&
      Objects.equals(this.status, webhookDeliveryResponseDto.status) &&
      Objects.equals(this.attempts, webhookDeliveryResponseDto.attempts) &&
      Objects.equals(
        this.responseStatus,
        webhookDeliveryResponseDto.responseStatus
      ) &&
      Objects.equals(this.lastError, webhookDeliveryResponseDto.lastError) &&
      Objects.equals(this.occurredAt, webhookDeliveryResponseDto.occurredAt) &&
      Objects.equals(this.deliveredAt, webhookDeliveryResponseDto.deliveredAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      eventId,
      eventType,
      status,
      attempts,
      responseStatus,
      lastError,
      occurredAt,
      deliveredAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class WebhookDeliveryResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    eventId: ").append(toIndentedString(eventId)).append("\n");
    sb.append("    eventType: ")
      .append(toIndentedString(eventType))
      .append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    attempts: ").append(toIndentedString(attempts)).append("\n");
    sb.append("    responseStatus: ")
      .append(toIndentedString(responseStatus))
      .append("\n");
    sb.append("    lastError: ")
      .append(toIndentedString(lastError))
      .append("\n");
    sb.append("    occurredAt: ")
      .append(toIndentedString(occurredAt))
      .append("\n");
    sb.append("    deliveredAt: ")
      .append(toIndentedString(deliveredAt))
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

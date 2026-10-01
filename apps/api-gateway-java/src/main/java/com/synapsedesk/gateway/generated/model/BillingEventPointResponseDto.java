package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * BillingEventPointResponseDto
 */

public class BillingEventPointResponseDto {

  private String day;

  private String eventType;

  private BigDecimal count;

  public BillingEventPointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BillingEventPointResponseDto(String day, String eventType, BigDecimal count) {
    this.day = day;
    this.eventType = eventType;
    this.count = count;
  }

  public BillingEventPointResponseDto day(String day) {
    this.day = day;
    return this;
  }

  /**
   * `YYYY-MM-DD`, UTC.
   * @return day
   */
  @NotNull 
  @JsonProperty("day")
  public String getDay() {
    return day;
  }

  @JsonProperty("day")
  public void setDay(String day) {
    this.day = day;
  }

  public BillingEventPointResponseDto eventType(String eventType) {
    this.eventType = eventType;
    return this;
  }

  /**
   * **A string, and it carries two vocabularies.**  In `points` it is Stripe's (`invoice.payment_failed`); in `currentlyOffboarded` it is `organization.offboarded`, which this system invented. A client writing a `switch` over this field will meet both.
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

  public BillingEventPointResponseDto count(BigDecimal count) {
    this.count = count;
    return this;
  }

  /**
   * Get count
   * @return count
   */
  @NotNull @Valid 
  @JsonProperty("count")
  public BigDecimal getCount() {
    return count;
  }

  @JsonProperty("count")
  public void setCount(BigDecimal count) {
    this.count = count;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BillingEventPointResponseDto billingEventPointResponseDto = (BillingEventPointResponseDto) o;
    return Objects.equals(this.day, billingEventPointResponseDto.day) &&
        Objects.equals(this.eventType, billingEventPointResponseDto.eventType) &&
        Objects.equals(this.count, billingEventPointResponseDto.count);
  }

  @Override
  public int hashCode() {
    return Objects.hash(day, eventType, count);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BillingEventPointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    eventType: ").append(toIndentedString(eventType)).append("\n");
    sb.append("    count: ").append(toIndentedString(count)).append("\n");
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


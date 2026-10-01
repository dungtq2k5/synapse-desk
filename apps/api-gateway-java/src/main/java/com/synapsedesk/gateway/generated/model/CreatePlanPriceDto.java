package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * CreatePlanPriceDto
 */

public class CreatePlanPriceDto {

  private String stripePriceId;

  /**
   * Gets or Sets interval
   */
  public enum IntervalEnum {
    MONTH("month"),
    
    YEAR("year");

    private final String value;

    IntervalEnum(String value) {
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
    public static IntervalEnum fromValue(String value) {
      for (IntervalEnum b : IntervalEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private IntervalEnum interval;

  public CreatePlanPriceDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreatePlanPriceDto(String stripePriceId, IntervalEnum interval) {
    this.stripePriceId = stripePriceId;
    this.interval = interval;
  }

  public CreatePlanPriceDto stripePriceId(String stripePriceId) {
    this.stripePriceId = stripePriceId;
    return this;
  }

  /**
   * Get stripePriceId
   * @return stripePriceId
   */
  @NotNull @Size(min = 1, max = 255) 
  @JsonProperty("stripePriceId")
  public String getStripePriceId() {
    return stripePriceId;
  }

  @JsonProperty("stripePriceId")
  public void setStripePriceId(String stripePriceId) {
    this.stripePriceId = stripePriceId;
  }

  public CreatePlanPriceDto interval(IntervalEnum interval) {
    this.interval = interval;
    return this;
  }

  /**
   * Get interval
   * @return interval
   */
  @NotNull 
  @JsonProperty("interval")
  public IntervalEnum getInterval() {
    return interval;
  }

  @JsonProperty("interval")
  public void setInterval(IntervalEnum interval) {
    this.interval = interval;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreatePlanPriceDto createPlanPriceDto = (CreatePlanPriceDto) o;
    return Objects.equals(this.stripePriceId, createPlanPriceDto.stripePriceId) &&
        Objects.equals(this.interval, createPlanPriceDto.interval);
  }

  @Override
  public int hashCode() {
    return Objects.hash(stripePriceId, interval);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreatePlanPriceDto {\n");
    sb.append("    stripePriceId: ").append(toIndentedString(stripePriceId)).append("\n");
    sb.append("    interval: ").append(toIndentedString(interval)).append("\n");
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


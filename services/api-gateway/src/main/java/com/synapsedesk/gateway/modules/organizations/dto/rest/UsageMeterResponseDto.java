package com.synapsedesk.gateway.modules.organizations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UsageMeterResponseDto
 */

public class UsageMeterResponseDto {

  private Boolean available;

  private BigDecimal used = null;

  private BigDecimal limit = null;

  /**
   * Why there's no number, when `available` is false: `READ_FAILED` (it
   * couldn't be read just now; try again) or `NOT_AVAILABLE` (this
   * organization has no such meter). Null when available.
   */
  public enum UnavailableReasonEnum {
    NOT_AVAILABLE("NOT_AVAILABLE"),

    READ_FAILED("READ_FAILED");

    private final String value;

    UnavailableReasonEnum(String value) {
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
    public static UnavailableReasonEnum fromValue(String value) {
      for (UnavailableReasonEnum b : UnavailableReasonEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private UnavailableReasonEnum unavailableReason = null;

  public UsageMeterResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UsageMeterResponseDto(
    Boolean available,
    BigDecimal used,
    BigDecimal limit,
    UnavailableReasonEnum unavailableReason
  ) {
    this.available = available;
    this.used = used;
    this.limit = limit;
    this.unavailableReason = unavailableReason;
  }

  public UsageMeterResponseDto available(Boolean available) {
    this.available = available;
    return this;
  }

  /**
   * Get available
   * @return available
   */
  @NotNull
  @JsonProperty("available")
  public Boolean getAvailable() {
    return available;
  }

  @JsonProperty("available")
  public void setAvailable(Boolean available) {
    this.available = available;
  }

  public UsageMeterResponseDto used(BigDecimal used) {
    this.used = used;
    return this;
  }

  /**
   * Get used
   * @return used
   */
  @Valid
  @JsonProperty("used")
  public BigDecimal getUsed() {
    return used;
  }

  @JsonProperty("used")
  public void setUsed(BigDecimal used) {
    this.used = used;
  }

  public UsageMeterResponseDto limit(BigDecimal limit) {
    this.limit = limit;
    return this;
  }

  /**
   * Get limit
   * @return limit
   */
  @Valid
  @JsonProperty("limit")
  public BigDecimal getLimit() {
    return limit;
  }

  @JsonProperty("limit")
  public void setLimit(BigDecimal limit) {
    this.limit = limit;
  }

  public UsageMeterResponseDto unavailableReason(
    UnavailableReasonEnum unavailableReason
  ) {
    this.unavailableReason = unavailableReason;
    return this;
  }

  /**
   * Why there's no number, when `available` is false. Null when available.
   * @return unavailableReason
   */

  @JsonProperty("unavailableReason")
  public UnavailableReasonEnum getUnavailableReason() {
    return unavailableReason;
  }

  @JsonProperty("unavailableReason")
  public void setUnavailableReason(UnavailableReasonEnum unavailableReason) {
    this.unavailableReason = unavailableReason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UsageMeterResponseDto usageMeterResponseDto = (UsageMeterResponseDto) o;
    return (
      Objects.equals(this.available, usageMeterResponseDto.available) &&
      Objects.equals(this.used, usageMeterResponseDto.used) &&
      Objects.equals(this.limit, usageMeterResponseDto.limit) &&
      Objects.equals(
        this.unavailableReason,
        usageMeterResponseDto.unavailableReason
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(available, used, limit, unavailableReason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UsageMeterResponseDto {\n");
    sb.append("    available: ")
      .append(toIndentedString(available))
      .append("\n");
    sb.append("    used: ").append(toIndentedString(used)).append("\n");
    sb.append("    limit: ").append(toIndentedString(limit)).append("\n");
    sb.append("    unavailableReason: ")
      .append(toIndentedString(unavailableReason))
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

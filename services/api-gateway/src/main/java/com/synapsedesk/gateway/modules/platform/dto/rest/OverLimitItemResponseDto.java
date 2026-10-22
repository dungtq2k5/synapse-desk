package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * One limit a plan breaks: what's in use against what it allows.
 */

public class OverLimitItemResponseDto {

  /**
   * Gets or Sets dimension
   */
  public enum DimensionEnum {
    DOCUMENTS("DOCUMENTS"),

    SEATS("SEATS"),

    STORAGE("STORAGE");

    private final String value;

    DimensionEnum(String value) {
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
    public static DimensionEnum fromValue(String value) {
      for (DimensionEnum b : DimensionEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private DimensionEnum dimension;

  private BigDecimal inUse;

  private BigDecimal allowed;

  public OverLimitItemResponseDto() {
    super();
  }

  public OverLimitItemResponseDto dimension(DimensionEnum dimension) {
    this.dimension = dimension;
    return this;
  }

  /**
   * Get dimension
   * @return dimension
   */
  @NotNull
  @JsonProperty("dimension")
  public DimensionEnum getDimension() {
    return dimension;
  }

  @JsonProperty("dimension")
  public void setDimension(DimensionEnum dimension) {
    this.dimension = dimension;
  }

  public OverLimitItemResponseDto inUse(BigDecimal inUse) {
    this.inUse = inUse;
    return this;
  }

  /**
   * Get inUse
   * @return inUse
   */
  @NotNull
  @Valid
  @JsonProperty("inUse")
  public BigDecimal getInUse() {
    return inUse;
  }

  @JsonProperty("inUse")
  public void setInUse(BigDecimal inUse) {
    this.inUse = inUse;
  }

  public OverLimitItemResponseDto allowed(BigDecimal allowed) {
    this.allowed = allowed;
    return this;
  }

  /**
   * Get allowed
   * @return allowed
   */
  @NotNull
  @Valid
  @JsonProperty("allowed")
  public BigDecimal getAllowed() {
    return allowed;
  }

  @JsonProperty("allowed")
  public void setAllowed(BigDecimal allowed) {
    this.allowed = allowed;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OverLimitItemResponseDto overLimitItemResponseDto =
      (OverLimitItemResponseDto) o;
    return (
      Objects.equals(this.dimension, overLimitItemResponseDto.dimension) &&
      Objects.equals(this.inUse, overLimitItemResponseDto.inUse) &&
      Objects.equals(this.allowed, overLimitItemResponseDto.allowed)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(dimension, inUse, allowed);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OverLimitItemResponseDto {\n");
    sb.append("    dimension: ")
      .append(toIndentedString(dimension))
      .append("\n");
    sb.append("    inUse: ").append(toIndentedString(inUse)).append("\n");
    sb.append("    allowed: ").append(toIndentedString(allowed)).append("\n");
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

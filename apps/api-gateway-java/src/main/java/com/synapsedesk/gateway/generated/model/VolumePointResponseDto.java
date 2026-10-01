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
 * VolumePointResponseDto
 */

public class VolumePointResponseDto {

  private String day;

  private BigDecimal created;

  private BigDecimal resolved;

  private BigDecimal escalated;

  public VolumePointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public VolumePointResponseDto(String day, BigDecimal created, BigDecimal resolved, BigDecimal escalated) {
    this.day = day;
    this.created = created;
    this.resolved = resolved;
    this.escalated = escalated;
  }

  public VolumePointResponseDto day(String day) {
    this.day = day;
    return this;
  }

  /**
   * Get day
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

  public VolumePointResponseDto created(BigDecimal created) {
    this.created = created;
    return this;
  }

  /**
   * Get created
   * @return created
   */
  @NotNull @Valid 
  @JsonProperty("created")
  public BigDecimal getCreated() {
    return created;
  }

  @JsonProperty("created")
  public void setCreated(BigDecimal created) {
    this.created = created;
  }

  public VolumePointResponseDto resolved(BigDecimal resolved) {
    this.resolved = resolved;
    return this;
  }

  /**
   * Get resolved
   * @return resolved
   */
  @NotNull @Valid 
  @JsonProperty("resolved")
  public BigDecimal getResolved() {
    return resolved;
  }

  @JsonProperty("resolved")
  public void setResolved(BigDecimal resolved) {
    this.resolved = resolved;
  }

  public VolumePointResponseDto escalated(BigDecimal escalated) {
    this.escalated = escalated;
    return this;
  }

  /**
   * Get escalated
   * @return escalated
   */
  @NotNull @Valid 
  @JsonProperty("escalated")
  public BigDecimal getEscalated() {
    return escalated;
  }

  @JsonProperty("escalated")
  public void setEscalated(BigDecimal escalated) {
    this.escalated = escalated;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    VolumePointResponseDto volumePointResponseDto = (VolumePointResponseDto) o;
    return Objects.equals(this.day, volumePointResponseDto.day) &&
        Objects.equals(this.created, volumePointResponseDto.created) &&
        Objects.equals(this.resolved, volumePointResponseDto.resolved) &&
        Objects.equals(this.escalated, volumePointResponseDto.escalated);
  }

  @Override
  public int hashCode() {
    return Objects.hash(day, created, resolved, escalated);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class VolumePointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    created: ").append(toIndentedString(created)).append("\n");
    sb.append("    resolved: ").append(toIndentedString(resolved)).append("\n");
    sb.append("    escalated: ").append(toIndentedString(escalated)).append("\n");
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


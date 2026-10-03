package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.BillingEventPointResponseDto;
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
 * BillingEventsResponseDto
 */

public class BillingEventsResponseDto {

  private List<@Valid BillingEventPointResponseDto> points = new ArrayList<>();

  private List<@Valid BillingEventPointResponseDto> currentlyOffboarded =
    new ArrayList<>();

  private List<String> observedEventTypes = new ArrayList<>();

  public BillingEventsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BillingEventsResponseDto(
    List<@Valid BillingEventPointResponseDto> points,
    List<@Valid BillingEventPointResponseDto> currentlyOffboarded,
    List<String> observedEventTypes
  ) {
    this.points = points;
    this.currentlyOffboarded = currentlyOffboarded;
    this.observedEventTypes = observedEventTypes;
  }

  public BillingEventsResponseDto points(
    List<@Valid BillingEventPointResponseDto> points
  ) {
    this.points = points;
    return this;
  }

  public BillingEventsResponseDto addPointsItem(
    BillingEventPointResponseDto pointsItem
  ) {
    if (this.points == null) {
      this.points = new ArrayList<>();
    }
    this.points.add(pointsItem);
    return this;
  }

  /**
   * Get points
   * @return points
   */
  @NotNull
  @Valid
  @JsonProperty("points")
  public List<@Valid BillingEventPointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid BillingEventPointResponseDto> points) {
    this.points = points;
  }

  public BillingEventsResponseDto currentlyOffboarded(
    List<@Valid BillingEventPointResponseDto> currentlyOffboarded
  ) {
    this.currentlyOffboarded = currentlyOffboarded;
    return this;
  }

  public BillingEventsResponseDto addCurrentlyOffboardedItem(
    BillingEventPointResponseDto currentlyOffboardedItem
  ) {
    if (this.currentlyOffboarded == null) {
      this.currentlyOffboarded = new ArrayList<>();
    }
    this.currentlyOffboarded.add(currentlyOffboardedItem);
    return this;
  }

  /**
   * Tenants CURRENTLY offboarded, bucketed by the day they were offboarded — a different ending from a cancellation.  **Named for the state rather than the event, deliberately.** It is derived from `organizations.deleted_at`, which a restore clears, so restoring a tenant removes it from every past range. As an event count that would be a series rewriting its own history; as a projection of current state it behaves as named. A stable churn line needs the audit log, which lives in another service.
   * @return currentlyOffboarded
   */
  @NotNull
  @Valid
  @JsonProperty("currentlyOffboarded")
  public List<@Valid BillingEventPointResponseDto> getCurrentlyOffboarded() {
    return currentlyOffboarded;
  }

  @JsonProperty("currentlyOffboarded")
  public void setCurrentlyOffboarded(
    List<@Valid BillingEventPointResponseDto> currentlyOffboarded
  ) {
    this.currentlyOffboarded = currentlyOffboarded;
  }

  public BillingEventsResponseDto observedEventTypes(
    List<String> observedEventTypes
  ) {
    this.observedEventTypes = observedEventTypes;
    return this;
  }

  public BillingEventsResponseDto addObservedEventTypesItem(
    String observedEventTypesItem
  ) {
    if (this.observedEventTypes == null) {
      this.observedEventTypes = new ArrayList<>();
    }
    this.observedEventTypes.add(observedEventTypesItem);
    return this;
  }

  /**
   * The event types actually seen in this range.  A type that has never arrived is visibly absent here rather than reported as a zero — and which types arrive at all is the Stripe endpoint's `enabled_events`, which nothing in this repository configures.
   * @return observedEventTypes
   */
  @NotNull
  @JsonProperty("observedEventTypes")
  public List<String> getObservedEventTypes() {
    return observedEventTypes;
  }

  @JsonProperty("observedEventTypes")
  public void setObservedEventTypes(List<String> observedEventTypes) {
    this.observedEventTypes = observedEventTypes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BillingEventsResponseDto billingEventsResponseDto =
      (BillingEventsResponseDto) o;
    return (
      Objects.equals(this.points, billingEventsResponseDto.points) &&
      Objects.equals(
        this.currentlyOffboarded,
        billingEventsResponseDto.currentlyOffboarded
      ) &&
      Objects.equals(
        this.observedEventTypes,
        billingEventsResponseDto.observedEventTypes
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(points, currentlyOffboarded, observedEventTypes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BillingEventsResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    currentlyOffboarded: ")
      .append(toIndentedString(currentlyOffboarded))
      .append("\n");
    sb.append("    observedEventTypes: ")
      .append(toIndentedString(observedEventTypes))
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

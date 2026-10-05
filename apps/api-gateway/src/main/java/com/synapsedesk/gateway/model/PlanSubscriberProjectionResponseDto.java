package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * PlanSubscriberProjectionResponseDto
 */

public class PlanSubscriberProjectionResponseDto {

  private String organizationId;

  private String organizationName;

  private Map<String, String> changes = new HashMap<>();

  private Map<String, BigDecimal> after = new HashMap<>();

  private List<String> overLimit = new ArrayList<>();

  private Boolean skippedPinned;

  private Boolean budgetDeferred;

  public PlanSubscriberProjectionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlanSubscriberProjectionResponseDto(
    String organizationId,
    String organizationName,
    Map<String, String> changes,
    Map<String, BigDecimal> after,
    List<String> overLimit,
    Boolean skippedPinned,
    Boolean budgetDeferred
  ) {
    this.organizationId = organizationId;
    this.organizationName = organizationName;
    this.changes = changes;
    this.after = after;
    this.overLimit = overLimit;
    this.skippedPinned = skippedPinned;
    this.budgetDeferred = budgetDeferred;
  }

  public PlanSubscriberProjectionResponseDto organizationId(
    String organizationId
  ) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public PlanSubscriberProjectionResponseDto organizationName(
    String organizationName
  ) {
    this.organizationName = organizationName;
    return this;
  }

  /**
   * Get organizationName
   * @return organizationName
   */
  @NotNull
  @JsonProperty("organizationName")
  public String getOrganizationName() {
    return organizationName;
  }

  @JsonProperty("organizationName")
  public void setOrganizationName(String organizationName) {
    this.organizationName = organizationName;
  }

  public PlanSubscriberProjectionResponseDto changes(
    Map<String, String> changes
  ) {
    this.changes = changes;
    return this;
  }

  public PlanSubscriberProjectionResponseDto putChangesItem(
    String key,
    String changesItem
  ) {
    if (this.changes == null) {
      this.changes = new HashMap<>();
    }
    this.changes.put(key, changesItem);
    return this;
  }

  /**
   * Field name → `\"before -> after\"`, for the columns this apply would change.
   * @return changes
   */
  @NotNull
  @JsonProperty("changes")
  public Map<String, String> getChanges() {
    return changes;
  }

  @JsonProperty("changes")
  public void setChanges(Map<String, String> changes) {
    this.changes = changes;
  }

  public PlanSubscriberProjectionResponseDto after(
    Map<String, BigDecimal> after
  ) {
    this.after = after;
    return this;
  }

  public PlanSubscriberProjectionResponseDto putAfterItem(
    String key,
    BigDecimal afterItem
  ) {
    if (this.after == null) {
      this.after = new HashMap<>();
    }
    this.after.put(key, afterItem);
    return this;
  }

  /**
   * The AFTER value of every NUMERIC column in `changes`, keyed the same way.  `changes` renders for a human; this is what a machine reads. A key absent here means the column is not changing — never \"zero\", which would put every tenant over. `aiModelTier` is a string and never appears.  known-gaps #21: the composer used to parse the display string, and a cosmetic change to its separator silently disarmed two limit checks.
   * @return after
   */
  @NotNull
  @Valid
  @JsonProperty("after")
  public Map<String, BigDecimal> getAfter() {
    return after;
  }

  @JsonProperty("after")
  public void setAfter(Map<String, BigDecimal> after) {
    this.after = after;
  }

  public PlanSubscriberProjectionResponseDto overLimit(List<String> overLimit) {
    this.overLimit = overLimit;
    return this;
  }

  public PlanSubscriberProjectionResponseDto addOverLimitItem(
    String overLimitItem
  ) {
    if (this.overLimit == null) {
      this.overLimit = new ArrayList<>();
    }
    this.overLimit.add(overLimitItem);
    return this;
  }

  /**
   * Limits this tenant is ALREADY past under the new plan.  Reported, never enforced: a limit gates admission, never tenure. These tenants keep everything they have and are refused their next addition.
   * @return overLimit
   */
  @NotNull
  @JsonProperty("overLimit")
  public List<String> getOverLimit() {
    return overLimit;
  }

  @JsonProperty("overLimit")
  public void setOverLimit(List<String> overLimit) {
    this.overLimit = overLimit;
  }

  public PlanSubscriberProjectionResponseDto skippedPinned(
    Boolean skippedPinned
  ) {
    this.skippedPinned = skippedPinned;
    return this;
  }

  /**
   * Off-catalogue by deliberate policy; this apply does not touch them.
   * @return skippedPinned
   */
  @NotNull
  @JsonProperty("skippedPinned")
  public Boolean getSkippedPinned() {
    return skippedPinned;
  }

  @JsonProperty("skippedPinned")
  public void setSkippedPinned(Boolean skippedPinned) {
    this.skippedPinned = skippedPinned;
  }

  public PlanSubscriberProjectionResponseDto budgetDeferred(
    Boolean budgetDeferred
  ) {
    this.budgetDeferred = budgetDeferred;
    return this;
  }

  /**
   * Held to the next cycle roll: lowering a part-spent budget is retroactive.
   * @return budgetDeferred
   */
  @NotNull
  @JsonProperty("budgetDeferred")
  public Boolean getBudgetDeferred() {
    return budgetDeferred;
  }

  @JsonProperty("budgetDeferred")
  public void setBudgetDeferred(Boolean budgetDeferred) {
    this.budgetDeferred = budgetDeferred;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlanSubscriberProjectionResponseDto planSubscriberProjectionResponseDto =
      (PlanSubscriberProjectionResponseDto) o;
    return (
      Objects.equals(
        this.organizationId,
        planSubscriberProjectionResponseDto.organizationId
      ) &&
      Objects.equals(
        this.organizationName,
        planSubscriberProjectionResponseDto.organizationName
      ) &&
      Objects.equals(
        this.changes,
        planSubscriberProjectionResponseDto.changes
      ) &&
      Objects.equals(this.after, planSubscriberProjectionResponseDto.after) &&
      Objects.equals(
        this.overLimit,
        planSubscriberProjectionResponseDto.overLimit
      ) &&
      Objects.equals(
        this.skippedPinned,
        planSubscriberProjectionResponseDto.skippedPinned
      ) &&
      Objects.equals(
        this.budgetDeferred,
        planSubscriberProjectionResponseDto.budgetDeferred
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      organizationId,
      organizationName,
      changes,
      after,
      overLimit,
      skippedPinned,
      budgetDeferred
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlanSubscriberProjectionResponseDto {\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    organizationName: ")
      .append(toIndentedString(organizationName))
      .append("\n");
    sb.append("    changes: ").append(toIndentedString(changes)).append("\n");
    sb.append("    after: ").append(toIndentedString(after)).append("\n");
    sb.append("    overLimit: ")
      .append(toIndentedString(overLimit))
      .append("\n");
    sb.append("    skippedPinned: ")
      .append(toIndentedString(skippedPinned))
      .append("\n");
    sb.append("    budgetDeferred: ")
      .append(toIndentedString(budgetDeferred))
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

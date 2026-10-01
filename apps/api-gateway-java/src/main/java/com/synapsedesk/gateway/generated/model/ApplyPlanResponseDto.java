package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.PlanSubscriberProjectionResponseDto;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * ApplyPlanResponseDto
 */

public class ApplyPlanResponseDto {

  private List<@Valid PlanSubscriberProjectionResponseDto> subscribers = new ArrayList<>();

  private Boolean dryRun;

  private BigDecimal changedCount;

  private BigDecimal skippedPinnedCount;

  private BigDecimal overLimitCount;

  private List<String> evaluatedDimensions = new ArrayList<>();

  public ApplyPlanResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ApplyPlanResponseDto(List<@Valid PlanSubscriberProjectionResponseDto> subscribers, Boolean dryRun, BigDecimal changedCount, BigDecimal skippedPinnedCount, BigDecimal overLimitCount, List<String> evaluatedDimensions) {
    this.subscribers = subscribers;
    this.dryRun = dryRun;
    this.changedCount = changedCount;
    this.skippedPinnedCount = skippedPinnedCount;
    this.overLimitCount = overLimitCount;
    this.evaluatedDimensions = evaluatedDimensions;
  }

  public ApplyPlanResponseDto subscribers(List<@Valid PlanSubscriberProjectionResponseDto> subscribers) {
    this.subscribers = subscribers;
    return this;
  }

  public ApplyPlanResponseDto addSubscribersItem(PlanSubscriberProjectionResponseDto subscribersItem) {
    if (this.subscribers == null) {
      this.subscribers = new ArrayList<>();
    }
    this.subscribers.add(subscribersItem);
    return this;
  }

  /**
   * Get subscribers
   * @return subscribers
   */
  @NotNull @Valid 
  @JsonProperty("subscribers")
  public List<@Valid PlanSubscriberProjectionResponseDto> getSubscribers() {
    return subscribers;
  }

  @JsonProperty("subscribers")
  public void setSubscribers(List<@Valid PlanSubscriberProjectionResponseDto> subscribers) {
    this.subscribers = subscribers;
  }

  public ApplyPlanResponseDto dryRun(Boolean dryRun) {
    this.dryRun = dryRun;
    return this;
  }

  /**
   * Get dryRun
   * @return dryRun
   */
  @NotNull 
  @JsonProperty("dryRun")
  public Boolean getDryRun() {
    return dryRun;
  }

  @JsonProperty("dryRun")
  public void setDryRun(Boolean dryRun) {
    this.dryRun = dryRun;
  }

  public ApplyPlanResponseDto changedCount(BigDecimal changedCount) {
    this.changedCount = changedCount;
    return this;
  }

  /**
   * Get changedCount
   * @return changedCount
   */
  @NotNull @Valid 
  @JsonProperty("changedCount")
  public BigDecimal getChangedCount() {
    return changedCount;
  }

  @JsonProperty("changedCount")
  public void setChangedCount(BigDecimal changedCount) {
    this.changedCount = changedCount;
  }

  public ApplyPlanResponseDto skippedPinnedCount(BigDecimal skippedPinnedCount) {
    this.skippedPinnedCount = skippedPinnedCount;
    return this;
  }

  /**
   * Get skippedPinnedCount
   * @return skippedPinnedCount
   */
  @NotNull @Valid 
  @JsonProperty("skippedPinnedCount")
  public BigDecimal getSkippedPinnedCount() {
    return skippedPinnedCount;
  }

  @JsonProperty("skippedPinnedCount")
  public void setSkippedPinnedCount(BigDecimal skippedPinnedCount) {
    this.skippedPinnedCount = skippedPinnedCount;
  }

  public ApplyPlanResponseDto overLimitCount(BigDecimal overLimitCount) {
    this.overLimitCount = overLimitCount;
    return this;
  }

  /**
   * Get overLimitCount
   * @return overLimitCount
   */
  @NotNull @Valid 
  @JsonProperty("overLimitCount")
  public BigDecimal getOverLimitCount() {
    return overLimitCount;
  }

  @JsonProperty("overLimitCount")
  public void setOverLimitCount(BigDecimal overLimitCount) {
    this.overLimitCount = overLimitCount;
  }

  public ApplyPlanResponseDto evaluatedDimensions(List<String> evaluatedDimensions) {
    this.evaluatedDimensions = evaluatedDimensions;
    return this;
  }

  public ApplyPlanResponseDto addEvaluatedDimensionsItem(String evaluatedDimensionsItem) {
    if (this.evaluatedDimensions == null) {
      this.evaluatedDimensions = new ArrayList<>();
    }
    this.evaluatedDimensions.add(evaluatedDimensionsItem);
    return this;
  }

  /**
   * Which limits this run actually checked.  A dimension absent from the list was NOT evaluated, and `overLimitCount` says nothing about it — render it as unknown rather than as zero affected.
   * @return evaluatedDimensions
   */
  @NotNull 
  @JsonProperty("evaluatedDimensions")
  public List<String> getEvaluatedDimensions() {
    return evaluatedDimensions;
  }

  @JsonProperty("evaluatedDimensions")
  public void setEvaluatedDimensions(List<String> evaluatedDimensions) {
    this.evaluatedDimensions = evaluatedDimensions;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ApplyPlanResponseDto applyPlanResponseDto = (ApplyPlanResponseDto) o;
    return Objects.equals(this.subscribers, applyPlanResponseDto.subscribers) &&
        Objects.equals(this.dryRun, applyPlanResponseDto.dryRun) &&
        Objects.equals(this.changedCount, applyPlanResponseDto.changedCount) &&
        Objects.equals(this.skippedPinnedCount, applyPlanResponseDto.skippedPinnedCount) &&
        Objects.equals(this.overLimitCount, applyPlanResponseDto.overLimitCount) &&
        Objects.equals(this.evaluatedDimensions, applyPlanResponseDto.evaluatedDimensions);
  }

  @Override
  public int hashCode() {
    return Objects.hash(subscribers, dryRun, changedCount, skippedPinnedCount, overLimitCount, evaluatedDimensions);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ApplyPlanResponseDto {\n");
    sb.append("    subscribers: ").append(toIndentedString(subscribers)).append("\n");
    sb.append("    dryRun: ").append(toIndentedString(dryRun)).append("\n");
    sb.append("    changedCount: ").append(toIndentedString(changedCount)).append("\n");
    sb.append("    skippedPinnedCount: ").append(toIndentedString(skippedPinnedCount)).append("\n");
    sb.append("    overLimitCount: ").append(toIndentedString(overLimitCount)).append("\n");
    sb.append("    evaluatedDimensions: ").append(toIndentedString(evaluatedDimensions)).append("\n");
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


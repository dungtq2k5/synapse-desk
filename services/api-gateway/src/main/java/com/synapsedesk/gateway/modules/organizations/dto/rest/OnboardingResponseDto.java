package com.synapsedesk.gateway.modules.organizations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.modules.organizations.dto.rest.OnboardingStepResponseDto;
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
 * OnboardingResponseDto
 */

public class OnboardingResponseDto {

  private List<@Valid OnboardingStepResponseDto> steps = new ArrayList<>();

  private Boolean canComplete;

  /**
   * `OrgStatus` — see {@link OrganizationResponseDto.status}.
   */
  public enum StatusEnum {
    ACTIVE("ACTIVE"),

    FROZEN("FROZEN"),

    PENDING_ONBOARDING("PENDING_ONBOARDING"),

    SUSPENDED_PAST_DUE("SUSPENDED_PAST_DUE");

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

  public OnboardingResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OnboardingResponseDto(
    List<@Valid OnboardingStepResponseDto> steps,
    Boolean canComplete,
    StatusEnum status
  ) {
    this.steps = steps;
    this.canComplete = canComplete;
    this.status = status;
  }

  public OnboardingResponseDto steps(
    List<@Valid OnboardingStepResponseDto> steps
  ) {
    this.steps = steps;
    return this;
  }

  public OnboardingResponseDto addStepsItem(
    OnboardingStepResponseDto stepsItem
  ) {
    if (this.steps == null) {
      this.steps = new ArrayList<>();
    }
    this.steps.add(stepsItem);
    return this;
  }

  /**
   * Get steps
   * @return steps
   */
  @NotNull
  @Valid
  @JsonProperty("steps")
  public List<@Valid OnboardingStepResponseDto> getSteps() {
    return steps;
  }

  @JsonProperty("steps")
  public void setSteps(List<@Valid OnboardingStepResponseDto> steps) {
    this.steps = steps;
  }

  public OnboardingResponseDto canComplete(Boolean canComplete) {
    this.canComplete = canComplete;
    return this;
  }

  /**
   * Get canComplete
   * @return canComplete
   */
  @NotNull
  @JsonProperty("canComplete")
  public Boolean getCanComplete() {
    return canComplete;
  }

  @JsonProperty("canComplete")
  public void setCanComplete(Boolean canComplete) {
    this.canComplete = canComplete;
  }

  public OnboardingResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `OrgStatus` — see {@link OrganizationResponseDto.status}.
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OnboardingResponseDto onboardingResponseDto = (OnboardingResponseDto) o;
    return (
      Objects.equals(this.steps, onboardingResponseDto.steps) &&
      Objects.equals(this.canComplete, onboardingResponseDto.canComplete) &&
      Objects.equals(this.status, onboardingResponseDto.status)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(steps, canComplete, status);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OnboardingResponseDto {\n");
    sb.append("    steps: ").append(toIndentedString(steps)).append("\n");
    sb.append("    canComplete: ")
      .append(toIndentedString(canComplete))
      .append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
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

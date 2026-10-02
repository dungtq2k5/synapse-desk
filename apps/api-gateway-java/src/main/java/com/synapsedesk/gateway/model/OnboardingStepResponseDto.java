package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * OnboardingStepResponseDto
 */

public class OnboardingStepResponseDto {

  private String key;

  private String label;

  private Boolean complete;

  public OnboardingStepResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OnboardingStepResponseDto(String key, String label, Boolean complete) {
    this.key = key;
    this.label = label;
    this.complete = complete;
  }

  public OnboardingStepResponseDto key(String key) {
    this.key = key;
    return this;
  }

  /**
   * Get key
   * @return key
   */
  @NotNull
  @JsonProperty("key")
  public String getKey() {
    return key;
  }

  @JsonProperty("key")
  public void setKey(String key) {
    this.key = key;
  }

  public OnboardingStepResponseDto label(String label) {
    this.label = label;
    return this;
  }

  /**
   * Get label
   * @return label
   */
  @NotNull
  @JsonProperty("label")
  public String getLabel() {
    return label;
  }

  @JsonProperty("label")
  public void setLabel(String label) {
    this.label = label;
  }

  public OnboardingStepResponseDto complete(Boolean complete) {
    this.complete = complete;
    return this;
  }

  /**
   * Get complete
   * @return complete
   */
  @NotNull
  @JsonProperty("complete")
  public Boolean getComplete() {
    return complete;
  }

  @JsonProperty("complete")
  public void setComplete(Boolean complete) {
    this.complete = complete;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OnboardingStepResponseDto onboardingStepResponseDto =
      (OnboardingStepResponseDto) o;
    return (
      Objects.equals(this.key, onboardingStepResponseDto.key) &&
      Objects.equals(this.label, onboardingStepResponseDto.label) &&
      Objects.equals(this.complete, onboardingStepResponseDto.complete)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(key, label, complete);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OnboardingStepResponseDto {\n");
    sb.append("    key: ").append(toIndentedString(key)).append("\n");
    sb.append("    label: ").append(toIndentedString(label)).append("\n");
    sb.append("    complete: ").append(toIndentedString(complete)).append("\n");
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

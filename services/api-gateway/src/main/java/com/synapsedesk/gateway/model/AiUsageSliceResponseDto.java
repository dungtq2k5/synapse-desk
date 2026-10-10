package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.MeanResponseDto;
import com.synapsedesk.gateway.model.RateResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AiUsageSliceResponseDto
 */

public class AiUsageSliceResponseDto {

  private String purpose;

  private String modelName;

  private BigDecimal generations;

  private BigDecimal promptTokens;

  private BigDecimal completionTokens;

  private BigDecimal costMicros;

  private MeanResponseDto latencyMs;

  private RateResponseDto failureRate;

  public AiUsageSliceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiUsageSliceResponseDto(
    String purpose,
    String modelName,
    BigDecimal generations,
    BigDecimal promptTokens,
    BigDecimal completionTokens,
    BigDecimal costMicros,
    MeanResponseDto latencyMs,
    RateResponseDto failureRate
  ) {
    this.purpose = purpose;
    this.modelName = modelName;
    this.generations = generations;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.costMicros = costMicros;
    this.latencyMs = latencyMs;
    this.failureRate = failureRate;
  }

  public AiUsageSliceResponseDto purpose(String purpose) {
    this.purpose = purpose;
    return this;
  }

  /**
   * Get purpose
   * @return purpose
   */
  @NotNull
  @JsonProperty("purpose")
  public String getPurpose() {
    return purpose;
  }

  @JsonProperty("purpose")
  public void setPurpose(String purpose) {
    this.purpose = purpose;
  }

  public AiUsageSliceResponseDto modelName(String modelName) {
    this.modelName = modelName;
    return this;
  }

  /**
   * Get modelName
   * @return modelName
   */
  @NotNull
  @JsonProperty("modelName")
  public String getModelName() {
    return modelName;
  }

  @JsonProperty("modelName")
  public void setModelName(String modelName) {
    this.modelName = modelName;
  }

  public AiUsageSliceResponseDto generations(BigDecimal generations) {
    this.generations = generations;
    return this;
  }

  /**
   * Get generations
   * @return generations
   */
  @NotNull
  @Valid
  @JsonProperty("generations")
  public BigDecimal getGenerations() {
    return generations;
  }

  @JsonProperty("generations")
  public void setGenerations(BigDecimal generations) {
    this.generations = generations;
  }

  public AiUsageSliceResponseDto promptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
    return this;
  }

  /**
   * Get promptTokens
   * @return promptTokens
   */
  @NotNull
  @Valid
  @JsonProperty("promptTokens")
  public BigDecimal getPromptTokens() {
    return promptTokens;
  }

  @JsonProperty("promptTokens")
  public void setPromptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
  }

  public AiUsageSliceResponseDto completionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
    return this;
  }

  /**
   * Get completionTokens
   * @return completionTokens
   */
  @NotNull
  @Valid
  @JsonProperty("completionTokens")
  public BigDecimal getCompletionTokens() {
    return completionTokens;
  }

  @JsonProperty("completionTokens")
  public void setCompletionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
  }

  public AiUsageSliceResponseDto costMicros(BigDecimal costMicros) {
    this.costMicros = costMicros;
    return this;
  }

  /**
   * Get costMicros
   * @return costMicros
   */
  @NotNull
  @Valid
  @JsonProperty("costMicros")
  public BigDecimal getCostMicros() {
    return costMicros;
  }

  @JsonProperty("costMicros")
  public void setCostMicros(BigDecimal costMicros) {
    this.costMicros = costMicros;
  }

  public AiUsageSliceResponseDto latencyMs(MeanResponseDto latencyMs) {
    this.latencyMs = latencyMs;
    return this;
  }

  /**
   * Get latencyMs
   * @return latencyMs
   */
  @NotNull
  @Valid
  @JsonProperty("latencyMs")
  public MeanResponseDto getLatencyMs() {
    return latencyMs;
  }

  @JsonProperty("latencyMs")
  public void setLatencyMs(MeanResponseDto latencyMs) {
    this.latencyMs = latencyMs;
  }

  public AiUsageSliceResponseDto failureRate(RateResponseDto failureRate) {
    this.failureRate = failureRate;
    return this;
  }

  /**
   * Get failureRate
   * @return failureRate
   */
  @NotNull
  @Valid
  @JsonProperty("failureRate")
  public RateResponseDto getFailureRate() {
    return failureRate;
  }

  @JsonProperty("failureRate")
  public void setFailureRate(RateResponseDto failureRate) {
    this.failureRate = failureRate;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiUsageSliceResponseDto aiUsageSliceResponseDto =
      (AiUsageSliceResponseDto) o;
    return (
      Objects.equals(this.purpose, aiUsageSliceResponseDto.purpose) &&
      Objects.equals(this.modelName, aiUsageSliceResponseDto.modelName) &&
      Objects.equals(this.generations, aiUsageSliceResponseDto.generations) &&
      Objects.equals(this.promptTokens, aiUsageSliceResponseDto.promptTokens) &&
      Objects.equals(
        this.completionTokens,
        aiUsageSliceResponseDto.completionTokens
      ) &&
      Objects.equals(this.costMicros, aiUsageSliceResponseDto.costMicros) &&
      Objects.equals(this.latencyMs, aiUsageSliceResponseDto.latencyMs) &&
      Objects.equals(this.failureRate, aiUsageSliceResponseDto.failureRate)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      purpose,
      modelName,
      generations,
      promptTokens,
      completionTokens,
      costMicros,
      latencyMs,
      failureRate
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiUsageSliceResponseDto {\n");
    sb.append("    purpose: ").append(toIndentedString(purpose)).append("\n");
    sb.append("    modelName: ")
      .append(toIndentedString(modelName))
      .append("\n");
    sb.append("    generations: ")
      .append(toIndentedString(generations))
      .append("\n");
    sb.append("    promptTokens: ")
      .append(toIndentedString(promptTokens))
      .append("\n");
    sb.append("    completionTokens: ")
      .append(toIndentedString(completionTokens))
      .append("\n");
    sb.append("    costMicros: ")
      .append(toIndentedString(costMicros))
      .append("\n");
    sb.append("    latencyMs: ")
      .append(toIndentedString(latencyMs))
      .append("\n");
    sb.append("    failureRate: ")
      .append(toIndentedString(failureRate))
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

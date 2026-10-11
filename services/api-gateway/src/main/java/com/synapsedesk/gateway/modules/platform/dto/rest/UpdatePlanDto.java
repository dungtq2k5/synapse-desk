package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.common.validation.Matches;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UpdatePlanDto
 */

public class UpdatePlanDto {

  private @Nullable String name;

  private @Nullable String stripeProductId;

  private @Nullable Boolean clearStripeProductId;

  private @Nullable BigDecimal maxAgentSeats;

  private @Nullable BigDecimal maxStorageBytes;

  private @Nullable BigDecimal monthlyAiTokenBudget;

  /**
   * Gets or Sets aiModelTier
   */
  public enum AiModelTierEnum {
    FAST("FAST"),

    QUALITY("QUALITY");

    private final String value;

    AiModelTierEnum(String value) {
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
    public static AiModelTierEnum fromValue(String value) {
      for (AiModelTierEnum b : AiModelTierEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable AiModelTierEnum aiModelTier;

  private @Nullable BigDecimal maxDocumentBytes;

  private @Nullable BigDecimal maxAttachmentBytes;

  private @Nullable BigDecimal maxDocumentUploads;

  private @Nullable BigDecimal maxAnalyticsRangeDays;

  private @Nullable Boolean isActive;

  public UpdatePlanDto name(@Nullable String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @Size(min = 2, max = 100)
  @JsonProperty("name")
  public @Nullable String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(@Nullable String name) {
    this.name = name;
  }

  public UpdatePlanDto stripeProductId(@Nullable String stripeProductId) {
    this.stripeProductId = stripeProductId;
    return this;
  }

  /**
   * Get stripeProductId
   * @return stripeProductId
   */
  @Size(max = 255)
  @Matches(regex = "^[A-Za-z0-9_-]+$")
  @JsonProperty("stripeProductId")
  public @Nullable String getStripeProductId() {
    return stripeProductId;
  }

  @JsonProperty("stripeProductId")
  public void setStripeProductId(@Nullable String stripeProductId) {
    this.stripeProductId = stripeProductId;
  }

  public UpdatePlanDto clearStripeProductId(
    @Nullable Boolean clearStripeProductId
  ) {
    this.clearStripeProductId = clearStripeProductId;
    return this;
  }

  /**
   * Get clearStripeProductId
   * @return clearStripeProductId
   */

  @JsonProperty("clearStripeProductId")
  public @Nullable Boolean getClearStripeProductId() {
    return clearStripeProductId;
  }

  @JsonProperty("clearStripeProductId")
  public void setClearStripeProductId(@Nullable Boolean clearStripeProductId) {
    this.clearStripeProductId = clearStripeProductId;
  }

  public UpdatePlanDto maxAgentSeats(@Nullable BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * minimum: 1
   * @return maxAgentSeats
   */
  @Valid
  @DecimalMin(value = "1")
  @JsonProperty("maxAgentSeats")
  public @Nullable BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(@Nullable BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public UpdatePlanDto maxStorageBytes(@Nullable BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * minimum: 0
   * @return maxStorageBytes
   */
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("maxStorageBytes")
  public @Nullable BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(@Nullable BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public UpdatePlanDto monthlyAiTokenBudget(
    @Nullable BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * minimum: 0
   * @return monthlyAiTokenBudget
   */
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("monthlyAiTokenBudget")
  public @Nullable BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(
    @Nullable BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  public UpdatePlanDto aiModelTier(@Nullable AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * Get aiModelTier
   * @return aiModelTier
   */

  @JsonProperty("aiModelTier")
  public @Nullable AiModelTierEnum getAiModelTier() {
    return aiModelTier;
  }

  @JsonProperty("aiModelTier")
  public void setAiModelTier(@Nullable AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
  }

  public UpdatePlanDto maxDocumentBytes(@Nullable BigDecimal maxDocumentBytes) {
    this.maxDocumentBytes = maxDocumentBytes;
    return this;
  }

  /**
   * Get maxDocumentBytes
   * minimum: 1
   * maximum: 104857600
   * @return maxDocumentBytes
   */
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "104857600")
  @JsonProperty("maxDocumentBytes")
  public @Nullable BigDecimal getMaxDocumentBytes() {
    return maxDocumentBytes;
  }

  @JsonProperty("maxDocumentBytes")
  public void setMaxDocumentBytes(@Nullable BigDecimal maxDocumentBytes) {
    this.maxDocumentBytes = maxDocumentBytes;
  }

  public UpdatePlanDto maxAttachmentBytes(
    @Nullable BigDecimal maxAttachmentBytes
  ) {
    this.maxAttachmentBytes = maxAttachmentBytes;
    return this;
  }

  /**
   * Get maxAttachmentBytes
   * minimum: 1
   * maximum: 10485760
   * @return maxAttachmentBytes
   */
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "10485760")
  @JsonProperty("maxAttachmentBytes")
  public @Nullable BigDecimal getMaxAttachmentBytes() {
    return maxAttachmentBytes;
  }

  @JsonProperty("maxAttachmentBytes")
  public void setMaxAttachmentBytes(@Nullable BigDecimal maxAttachmentBytes) {
    this.maxAttachmentBytes = maxAttachmentBytes;
  }

  public UpdatePlanDto maxDocumentUploads(
    @Nullable BigDecimal maxDocumentUploads
  ) {
    this.maxDocumentUploads = maxDocumentUploads;
    return this;
  }

  /**
   * Get maxDocumentUploads
   * minimum: 1
   * maximum: 100000
   * @return maxDocumentUploads
   */
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "100000")
  @JsonProperty("maxDocumentUploads")
  public @Nullable BigDecimal getMaxDocumentUploads() {
    return maxDocumentUploads;
  }

  @JsonProperty("maxDocumentUploads")
  public void setMaxDocumentUploads(@Nullable BigDecimal maxDocumentUploads) {
    this.maxDocumentUploads = maxDocumentUploads;
  }

  public UpdatePlanDto maxAnalyticsRangeDays(
    @Nullable BigDecimal maxAnalyticsRangeDays
  ) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    return this;
  }

  /**
   * Get maxAnalyticsRangeDays
   * minimum: 1
   * maximum: 400
   * @return maxAnalyticsRangeDays
   */
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "400")
  @JsonProperty("maxAnalyticsRangeDays")
  public @Nullable BigDecimal getMaxAnalyticsRangeDays() {
    return maxAnalyticsRangeDays;
  }

  @JsonProperty("maxAnalyticsRangeDays")
  public void setMaxAnalyticsRangeDays(
    @Nullable BigDecimal maxAnalyticsRangeDays
  ) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
  }

  public UpdatePlanDto isActive(@Nullable Boolean isActive) {
    this.isActive = isActive;
    return this;
  }

  /**
   * Get isActive
   * @return isActive
   */

  @JsonProperty("isActive")
  public @Nullable Boolean getIsActive() {
    return isActive;
  }

  @JsonProperty("isActive")
  public void setIsActive(@Nullable Boolean isActive) {
    this.isActive = isActive;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdatePlanDto updatePlanDto = (UpdatePlanDto) o;
    return (
      Objects.equals(this.name, updatePlanDto.name) &&
      Objects.equals(this.stripeProductId, updatePlanDto.stripeProductId) &&
      Objects.equals(
        this.clearStripeProductId,
        updatePlanDto.clearStripeProductId
      ) &&
      Objects.equals(this.maxAgentSeats, updatePlanDto.maxAgentSeats) &&
      Objects.equals(this.maxStorageBytes, updatePlanDto.maxStorageBytes) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        updatePlanDto.monthlyAiTokenBudget
      ) &&
      Objects.equals(this.aiModelTier, updatePlanDto.aiModelTier) &&
      Objects.equals(this.maxDocumentBytes, updatePlanDto.maxDocumentBytes) &&
      Objects.equals(
        this.maxAttachmentBytes,
        updatePlanDto.maxAttachmentBytes
      ) &&
      Objects.equals(
        this.maxDocumentUploads,
        updatePlanDto.maxDocumentUploads
      ) &&
      Objects.equals(
        this.maxAnalyticsRangeDays,
        updatePlanDto.maxAnalyticsRangeDays
      ) &&
      Objects.equals(this.isActive, updatePlanDto.isActive)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      name,
      stripeProductId,
      clearStripeProductId,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget,
      aiModelTier,
      maxDocumentBytes,
      maxAttachmentBytes,
      maxDocumentUploads,
      maxAnalyticsRangeDays,
      isActive
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdatePlanDto {\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    stripeProductId: ")
      .append(toIndentedString(stripeProductId))
      .append("\n");
    sb.append("    clearStripeProductId: ")
      .append(toIndentedString(clearStripeProductId))
      .append("\n");
    sb.append("    maxAgentSeats: ")
      .append(toIndentedString(maxAgentSeats))
      .append("\n");
    sb.append("    maxStorageBytes: ")
      .append(toIndentedString(maxStorageBytes))
      .append("\n");
    sb.append("    monthlyAiTokenBudget: ")
      .append(toIndentedString(monthlyAiTokenBudget))
      .append("\n");
    sb.append("    aiModelTier: ")
      .append(toIndentedString(aiModelTier))
      .append("\n");
    sb.append("    maxDocumentBytes: ")
      .append(toIndentedString(maxDocumentBytes))
      .append("\n");
    sb.append("    maxAttachmentBytes: ")
      .append(toIndentedString(maxAttachmentBytes))
      .append("\n");
    sb.append("    maxDocumentUploads: ")
      .append(toIndentedString(maxDocumentUploads))
      .append("\n");
    sb.append("    maxAnalyticsRangeDays: ")
      .append(toIndentedString(maxAnalyticsRangeDays))
      .append("\n");
    sb.append("    isActive: ").append(toIndentedString(isActive)).append("\n");
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

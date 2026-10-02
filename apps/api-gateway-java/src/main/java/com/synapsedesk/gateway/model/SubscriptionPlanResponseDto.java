package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.SubscriptionPlanPriceResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * SubscriptionPlanResponseDto
 */

public class SubscriptionPlanResponseDto {

  private String id;

  private String name;

  private String stripeProductId = null;

  private BigDecimal maxAgentSeats;

  private BigDecimal maxStorageBytes;

  private BigDecimal monthlyAiTokenBudget;

  private String aiModelTier;

  private BigDecimal maxDocumentBytes;

  private BigDecimal maxAttachmentBytes;

  private BigDecimal maxDocumentUploads;

  private BigDecimal maxAnalyticsRangeDays;

  private Boolean isActive;

  private List<@Valid SubscriptionPlanPriceResponseDto> prices =
    new ArrayList<>();

  private BigDecimal subscriberCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  public SubscriptionPlanResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SubscriptionPlanResponseDto(
    String id,
    String name,
    String stripeProductId,
    BigDecimal maxAgentSeats,
    BigDecimal maxStorageBytes,
    BigDecimal monthlyAiTokenBudget,
    String aiModelTier,
    BigDecimal maxDocumentBytes,
    BigDecimal maxAttachmentBytes,
    BigDecimal maxDocumentUploads,
    BigDecimal maxAnalyticsRangeDays,
    Boolean isActive,
    List<@Valid SubscriptionPlanPriceResponseDto> prices,
    BigDecimal subscriberCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    OffsetDateTime deletedAt
  ) {
    this.id = id;
    this.name = name;
    this.stripeProductId = stripeProductId;
    this.maxAgentSeats = maxAgentSeats;
    this.maxStorageBytes = maxStorageBytes;
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    this.aiModelTier = aiModelTier;
    this.maxDocumentBytes = maxDocumentBytes;
    this.maxAttachmentBytes = maxAttachmentBytes;
    this.maxDocumentUploads = maxDocumentUploads;
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    this.isActive = isActive;
    this.prices = prices;
    this.subscriberCount = subscriberCount;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.deletedAt = deletedAt;
  }

  public SubscriptionPlanResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public SubscriptionPlanResponseDto name(String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @NotNull
  @JsonProperty("name")
  public String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(String name) {
    this.name = name;
  }

  public SubscriptionPlanResponseDto stripeProductId(String stripeProductId) {
    this.stripeProductId = stripeProductId;
    return this;
  }

  /**
   * NULL for a plan ASSIGNED rather than sold — the negotiated agreement.
   * @return stripeProductId
   */

  @JsonProperty("stripeProductId")
  public String getStripeProductId() {
    return stripeProductId;
  }

  @JsonProperty("stripeProductId")
  public void setStripeProductId(String stripeProductId) {
    this.stripeProductId = stripeProductId;
  }

  public SubscriptionPlanResponseDto maxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * @return maxAgentSeats
   */
  @NotNull
  @Valid
  @JsonProperty("maxAgentSeats")
  public BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public SubscriptionPlanResponseDto maxStorageBytes(
    BigDecimal maxStorageBytes
  ) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * @return maxStorageBytes
   */
  @NotNull
  @Valid
  @JsonProperty("maxStorageBytes")
  public BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public SubscriptionPlanResponseDto monthlyAiTokenBudget(
    BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * @return monthlyAiTokenBudget
   */
  @NotNull
  @Valid
  @JsonProperty("monthlyAiTokenBudget")
  public BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  public SubscriptionPlanResponseDto aiModelTier(String aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * Get aiModelTier
   * @return aiModelTier
   */
  @NotNull
  @JsonProperty("aiModelTier")
  public String getAiModelTier() {
    return aiModelTier;
  }

  @JsonProperty("aiModelTier")
  public void setAiModelTier(String aiModelTier) {
    this.aiModelTier = aiModelTier;
  }

  public SubscriptionPlanResponseDto maxDocumentBytes(
    BigDecimal maxDocumentBytes
  ) {
    this.maxDocumentBytes = maxDocumentBytes;
    return this;
  }

  /**
   * Get maxDocumentBytes
   * @return maxDocumentBytes
   */
  @NotNull
  @Valid
  @JsonProperty("maxDocumentBytes")
  public BigDecimal getMaxDocumentBytes() {
    return maxDocumentBytes;
  }

  @JsonProperty("maxDocumentBytes")
  public void setMaxDocumentBytes(BigDecimal maxDocumentBytes) {
    this.maxDocumentBytes = maxDocumentBytes;
  }

  public SubscriptionPlanResponseDto maxAttachmentBytes(
    BigDecimal maxAttachmentBytes
  ) {
    this.maxAttachmentBytes = maxAttachmentBytes;
    return this;
  }

  /**
   * Get maxAttachmentBytes
   * @return maxAttachmentBytes
   */
  @NotNull
  @Valid
  @JsonProperty("maxAttachmentBytes")
  public BigDecimal getMaxAttachmentBytes() {
    return maxAttachmentBytes;
  }

  @JsonProperty("maxAttachmentBytes")
  public void setMaxAttachmentBytes(BigDecimal maxAttachmentBytes) {
    this.maxAttachmentBytes = maxAttachmentBytes;
  }

  public SubscriptionPlanResponseDto maxDocumentUploads(
    BigDecimal maxDocumentUploads
  ) {
    this.maxDocumentUploads = maxDocumentUploads;
    return this;
  }

  /**
   * Get maxDocumentUploads
   * @return maxDocumentUploads
   */
  @NotNull
  @Valid
  @JsonProperty("maxDocumentUploads")
  public BigDecimal getMaxDocumentUploads() {
    return maxDocumentUploads;
  }

  @JsonProperty("maxDocumentUploads")
  public void setMaxDocumentUploads(BigDecimal maxDocumentUploads) {
    this.maxDocumentUploads = maxDocumentUploads;
  }

  public SubscriptionPlanResponseDto maxAnalyticsRangeDays(
    BigDecimal maxAnalyticsRangeDays
  ) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    return this;
  }

  /**
   * Days of history analytics may look back over. Narrowing it is retroactive.
   * @return maxAnalyticsRangeDays
   */
  @NotNull
  @Valid
  @JsonProperty("maxAnalyticsRangeDays")
  public BigDecimal getMaxAnalyticsRangeDays() {
    return maxAnalyticsRangeDays;
  }

  @JsonProperty("maxAnalyticsRangeDays")
  public void setMaxAnalyticsRangeDays(BigDecimal maxAnalyticsRangeDays) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
  }

  public SubscriptionPlanResponseDto isActive(Boolean isActive) {
    this.isActive = isActive;
    return this;
  }

  /**
   * Get isActive
   * @return isActive
   */
  @NotNull
  @JsonProperty("isActive")
  public Boolean getIsActive() {
    return isActive;
  }

  @JsonProperty("isActive")
  public void setIsActive(Boolean isActive) {
    this.isActive = isActive;
  }

  public SubscriptionPlanResponseDto prices(
    List<@Valid SubscriptionPlanPriceResponseDto> prices
  ) {
    this.prices = prices;
    return this;
  }

  public SubscriptionPlanResponseDto addPricesItem(
    SubscriptionPlanPriceResponseDto pricesItem
  ) {
    if (this.prices == null) {
      this.prices = new ArrayList<>();
    }
    this.prices.add(pricesItem);
    return this;
  }

  /**
   * Get prices
   * @return prices
   */
  @NotNull
  @Valid
  @JsonProperty("prices")
  public List<@Valid SubscriptionPlanPriceResponseDto> getPrices() {
    return prices;
  }

  @JsonProperty("prices")
  public void setPrices(List<@Valid SubscriptionPlanPriceResponseDto> prices) {
    this.prices = prices;
  }

  public SubscriptionPlanResponseDto subscriberCount(
    BigDecimal subscriberCount
  ) {
    this.subscriberCount = subscriberCount;
    return this;
  }

  /**
   * Live tenants on this plan: the delete gate and the apply's blast radius.
   * @return subscriberCount
   */
  @NotNull
  @Valid
  @JsonProperty("subscriberCount")
  public BigDecimal getSubscriberCount() {
    return subscriberCount;
  }

  @JsonProperty("subscriberCount")
  public void setSubscriberCount(BigDecimal subscriberCount) {
    this.subscriberCount = subscriberCount;
  }

  public SubscriptionPlanResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public SubscriptionPlanResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  public SubscriptionPlanResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Get deletedAt
   * @return deletedAt
   */
  @Valid
  @JsonProperty("deletedAt")
  public OffsetDateTime getDeletedAt() {
    return deletedAt;
  }

  @JsonProperty("deletedAt")
  public void setDeletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SubscriptionPlanResponseDto subscriptionPlanResponseDto =
      (SubscriptionPlanResponseDto) o;
    return (
      Objects.equals(this.id, subscriptionPlanResponseDto.id) &&
      Objects.equals(this.name, subscriptionPlanResponseDto.name) &&
      Objects.equals(
        this.stripeProductId,
        subscriptionPlanResponseDto.stripeProductId
      ) &&
      Objects.equals(
        this.maxAgentSeats,
        subscriptionPlanResponseDto.maxAgentSeats
      ) &&
      Objects.equals(
        this.maxStorageBytes,
        subscriptionPlanResponseDto.maxStorageBytes
      ) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        subscriptionPlanResponseDto.monthlyAiTokenBudget
      ) &&
      Objects.equals(
        this.aiModelTier,
        subscriptionPlanResponseDto.aiModelTier
      ) &&
      Objects.equals(
        this.maxDocumentBytes,
        subscriptionPlanResponseDto.maxDocumentBytes
      ) &&
      Objects.equals(
        this.maxAttachmentBytes,
        subscriptionPlanResponseDto.maxAttachmentBytes
      ) &&
      Objects.equals(
        this.maxDocumentUploads,
        subscriptionPlanResponseDto.maxDocumentUploads
      ) &&
      Objects.equals(
        this.maxAnalyticsRangeDays,
        subscriptionPlanResponseDto.maxAnalyticsRangeDays
      ) &&
      Objects.equals(this.isActive, subscriptionPlanResponseDto.isActive) &&
      Objects.equals(this.prices, subscriptionPlanResponseDto.prices) &&
      Objects.equals(
        this.subscriberCount,
        subscriptionPlanResponseDto.subscriberCount
      ) &&
      Objects.equals(this.createdAt, subscriptionPlanResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, subscriptionPlanResponseDto.updatedAt) &&
      Objects.equals(this.deletedAt, subscriptionPlanResponseDto.deletedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      name,
      stripeProductId,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget,
      aiModelTier,
      maxDocumentBytes,
      maxAttachmentBytes,
      maxDocumentUploads,
      maxAnalyticsRangeDays,
      isActive,
      prices,
      subscriberCount,
      createdAt,
      updatedAt,
      deletedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SubscriptionPlanResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    stripeProductId: ")
      .append(toIndentedString(stripeProductId))
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
    sb.append("    prices: ").append(toIndentedString(prices)).append("\n");
    sb.append("    subscriberCount: ")
      .append(toIndentedString(subscriberCount))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
      .append("\n");
    sb.append("    deletedAt: ")
      .append(toIndentedString(deletedAt))
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

package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.model.CreatePlanPriceDto;
import com.synapsedesk.gateway.validation.Matches;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreatePlanDto
 */

public class CreatePlanDto {

  private Boolean isActive = true;

  private List<@Valid CreatePlanPriceDto> prices = new ArrayList<>();

  private String name;

  private @Nullable String stripeProductId;

  private BigDecimal maxAgentSeats;

  private BigDecimal maxStorageBytes;

  private BigDecimal monthlyAiTokenBudget;

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

  private AiModelTierEnum aiModelTier;

  private BigDecimal maxDocumentBytes;

  private BigDecimal maxAttachmentBytes;

  private BigDecimal maxDocumentUploads;

  private BigDecimal maxAnalyticsRangeDays;

  public CreatePlanDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreatePlanDto(
    String name,
    BigDecimal maxAgentSeats,
    BigDecimal maxStorageBytes,
    BigDecimal monthlyAiTokenBudget,
    AiModelTierEnum aiModelTier,
    BigDecimal maxDocumentBytes,
    BigDecimal maxAttachmentBytes,
    BigDecimal maxDocumentUploads,
    BigDecimal maxAnalyticsRangeDays
  ) {
    this.name = name;
    this.maxAgentSeats = maxAgentSeats;
    this.maxStorageBytes = maxStorageBytes;
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    this.aiModelTier = aiModelTier;
    this.maxDocumentBytes = maxDocumentBytes;
    this.maxAttachmentBytes = maxAttachmentBytes;
    this.maxDocumentUploads = maxDocumentUploads;
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
  }

  public CreatePlanDto isActive(Boolean isActive) {
    this.isActive = isActive;
    return this;
  }

  /**
   * Get isActive
   * @return isActive
   */

  @JsonProperty("isActive")
  public Boolean getIsActive() {
    return isActive;
  }

  @JsonProperty("isActive")
  public void setIsActive(Boolean isActive) {
    this.isActive = isActive;
  }

  public CreatePlanDto prices(List<@Valid CreatePlanPriceDto> prices) {
    this.prices = prices;
    return this;
  }

  public CreatePlanDto addPricesItem(CreatePlanPriceDto pricesItem) {
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
  @Valid
  @JsonProperty("prices")
  public List<@Valid CreatePlanPriceDto> getPrices() {
    return prices;
  }

  @JsonProperty("prices")
  public void setPrices(List<@Valid CreatePlanPriceDto> prices) {
    this.prices = prices;
  }

  public CreatePlanDto name(String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @NotNull
  @Size(min = 2, max = 100)
  @JsonProperty("name")
  public String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(String name) {
    this.name = name;
  }

  public CreatePlanDto stripeProductId(@Nullable String stripeProductId) {
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

  public CreatePlanDto maxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * minimum: 1
   * @return maxAgentSeats
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @JsonProperty("maxAgentSeats")
  public BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public CreatePlanDto maxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * minimum: 0
   * @return maxStorageBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("maxStorageBytes")
  public BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public CreatePlanDto monthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * minimum: 0
   * @return monthlyAiTokenBudget
   */
  @NotNull
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("monthlyAiTokenBudget")
  public BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  public CreatePlanDto aiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * Get aiModelTier
   * @return aiModelTier
   */
  @NotNull
  @JsonProperty("aiModelTier")
  public AiModelTierEnum getAiModelTier() {
    return aiModelTier;
  }

  @JsonProperty("aiModelTier")
  public void setAiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
  }

  public CreatePlanDto maxDocumentBytes(BigDecimal maxDocumentBytes) {
    this.maxDocumentBytes = maxDocumentBytes;
    return this;
  }

  /**
   * Get maxDocumentBytes
   * minimum: 1
   * maximum: 104857600
   * @return maxDocumentBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "104857600")
  @JsonProperty("maxDocumentBytes")
  public BigDecimal getMaxDocumentBytes() {
    return maxDocumentBytes;
  }

  @JsonProperty("maxDocumentBytes")
  public void setMaxDocumentBytes(BigDecimal maxDocumentBytes) {
    this.maxDocumentBytes = maxDocumentBytes;
  }

  public CreatePlanDto maxAttachmentBytes(BigDecimal maxAttachmentBytes) {
    this.maxAttachmentBytes = maxAttachmentBytes;
    return this;
  }

  /**
   * Get maxAttachmentBytes
   * minimum: 1
   * maximum: 10485760
   * @return maxAttachmentBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "10485760")
  @JsonProperty("maxAttachmentBytes")
  public BigDecimal getMaxAttachmentBytes() {
    return maxAttachmentBytes;
  }

  @JsonProperty("maxAttachmentBytes")
  public void setMaxAttachmentBytes(BigDecimal maxAttachmentBytes) {
    this.maxAttachmentBytes = maxAttachmentBytes;
  }

  public CreatePlanDto maxDocumentUploads(BigDecimal maxDocumentUploads) {
    this.maxDocumentUploads = maxDocumentUploads;
    return this;
  }

  /**
   * Get maxDocumentUploads
   * minimum: 1
   * maximum: 100000
   * @return maxDocumentUploads
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "100000")
  @JsonProperty("maxDocumentUploads")
  public BigDecimal getMaxDocumentUploads() {
    return maxDocumentUploads;
  }

  @JsonProperty("maxDocumentUploads")
  public void setMaxDocumentUploads(BigDecimal maxDocumentUploads) {
    this.maxDocumentUploads = maxDocumentUploads;
  }

  public CreatePlanDto maxAnalyticsRangeDays(BigDecimal maxAnalyticsRangeDays) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    return this;
  }

  /**
   * Get maxAnalyticsRangeDays
   * minimum: 1
   * maximum: 400
   * @return maxAnalyticsRangeDays
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "400")
  @JsonProperty("maxAnalyticsRangeDays")
  public BigDecimal getMaxAnalyticsRangeDays() {
    return maxAnalyticsRangeDays;
  }

  @JsonProperty("maxAnalyticsRangeDays")
  public void setMaxAnalyticsRangeDays(BigDecimal maxAnalyticsRangeDays) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreatePlanDto createPlanDto = (CreatePlanDto) o;
    return (
      Objects.equals(this.isActive, createPlanDto.isActive) &&
      Objects.equals(this.prices, createPlanDto.prices) &&
      Objects.equals(this.name, createPlanDto.name) &&
      Objects.equals(this.stripeProductId, createPlanDto.stripeProductId) &&
      Objects.equals(this.maxAgentSeats, createPlanDto.maxAgentSeats) &&
      Objects.equals(this.maxStorageBytes, createPlanDto.maxStorageBytes) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        createPlanDto.monthlyAiTokenBudget
      ) &&
      Objects.equals(this.aiModelTier, createPlanDto.aiModelTier) &&
      Objects.equals(this.maxDocumentBytes, createPlanDto.maxDocumentBytes) &&
      Objects.equals(
        this.maxAttachmentBytes,
        createPlanDto.maxAttachmentBytes
      ) &&
      Objects.equals(
        this.maxDocumentUploads,
        createPlanDto.maxDocumentUploads
      ) &&
      Objects.equals(
        this.maxAnalyticsRangeDays,
        createPlanDto.maxAnalyticsRangeDays
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      isActive,
      prices,
      name,
      stripeProductId,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget,
      aiModelTier,
      maxDocumentBytes,
      maxAttachmentBytes,
      maxDocumentUploads,
      maxAnalyticsRangeDays
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreatePlanDto {\n");
    sb.append("    isActive: ").append(toIndentedString(isActive)).append("\n");
    sb.append("    prices: ").append(toIndentedString(prices)).append("\n");
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

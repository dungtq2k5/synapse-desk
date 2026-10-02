package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.model.TenantPlanPriceResponseDto;
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
import org.springframework.lang.Nullable;

/**
 * TenantPlanResponseDto
 */

public class TenantPlanResponseDto {

  private String id;

  private String name;

  private BigDecimal maxAgentSeats;

  private BigDecimal maxStorageBytes;

  private BigDecimal monthlyAiTokenBudget;

  /**
   * `AiModelTier` — see {@link SubscriptionResponseDto.aiModelTier}.
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
      return null;
    }
  }

  private AiModelTierEnum aiModelTier = null;

  private BigDecimal maxDocumentBytes;

  private BigDecimal maxAttachmentBytes;

  private BigDecimal maxDocumentUploads;

  private BigDecimal maxAnalyticsRangeDays;

  private List<@Valid TenantPlanPriceResponseDto> prices = new ArrayList<>();

  public TenantPlanResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TenantPlanResponseDto(
    String id,
    String name,
    BigDecimal maxAgentSeats,
    BigDecimal maxStorageBytes,
    BigDecimal monthlyAiTokenBudget,
    AiModelTierEnum aiModelTier,
    BigDecimal maxDocumentBytes,
    BigDecimal maxAttachmentBytes,
    BigDecimal maxDocumentUploads,
    BigDecimal maxAnalyticsRangeDays,
    List<@Valid TenantPlanPriceResponseDto> prices
  ) {
    this.id = id;
    this.name = name;
    this.maxAgentSeats = maxAgentSeats;
    this.maxStorageBytes = maxStorageBytes;
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    this.aiModelTier = aiModelTier;
    this.maxDocumentBytes = maxDocumentBytes;
    this.maxAttachmentBytes = maxAttachmentBytes;
    this.maxDocumentUploads = maxDocumentUploads;
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    this.prices = prices;
  }

  public TenantPlanResponseDto id(String id) {
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

  public TenantPlanResponseDto name(String name) {
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

  public TenantPlanResponseDto maxAgentSeats(BigDecimal maxAgentSeats) {
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

  public TenantPlanResponseDto maxStorageBytes(BigDecimal maxStorageBytes) {
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

  public TenantPlanResponseDto monthlyAiTokenBudget(
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

  public TenantPlanResponseDto aiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * `AiModelTier` — see {@link SubscriptionResponseDto.aiModelTier}.
   * @return aiModelTier
   */

  @JsonProperty("aiModelTier")
  public AiModelTierEnum getAiModelTier() {
    return aiModelTier;
  }

  @JsonProperty("aiModelTier")
  public void setAiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
  }

  public TenantPlanResponseDto maxDocumentBytes(BigDecimal maxDocumentBytes) {
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

  public TenantPlanResponseDto maxAttachmentBytes(
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

  public TenantPlanResponseDto maxDocumentUploads(
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

  public TenantPlanResponseDto maxAnalyticsRangeDays(
    BigDecimal maxAnalyticsRangeDays
  ) {
    this.maxAnalyticsRangeDays = maxAnalyticsRangeDays;
    return this;
  }

  /**
   * Get maxAnalyticsRangeDays
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

  public TenantPlanResponseDto prices(
    List<@Valid TenantPlanPriceResponseDto> prices
  ) {
    this.prices = prices;
    return this;
  }

  public TenantPlanResponseDto addPricesItem(
    TenantPlanPriceResponseDto pricesItem
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
  public List<@Valid TenantPlanPriceResponseDto> getPrices() {
    return prices;
  }

  @JsonProperty("prices")
  public void setPrices(List<@Valid TenantPlanPriceResponseDto> prices) {
    this.prices = prices;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TenantPlanResponseDto tenantPlanResponseDto = (TenantPlanResponseDto) o;
    return (
      Objects.equals(this.id, tenantPlanResponseDto.id) &&
      Objects.equals(this.name, tenantPlanResponseDto.name) &&
      Objects.equals(this.maxAgentSeats, tenantPlanResponseDto.maxAgentSeats) &&
      Objects.equals(
        this.maxStorageBytes,
        tenantPlanResponseDto.maxStorageBytes
      ) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        tenantPlanResponseDto.monthlyAiTokenBudget
      ) &&
      Objects.equals(this.aiModelTier, tenantPlanResponseDto.aiModelTier) &&
      Objects.equals(
        this.maxDocumentBytes,
        tenantPlanResponseDto.maxDocumentBytes
      ) &&
      Objects.equals(
        this.maxAttachmentBytes,
        tenantPlanResponseDto.maxAttachmentBytes
      ) &&
      Objects.equals(
        this.maxDocumentUploads,
        tenantPlanResponseDto.maxDocumentUploads
      ) &&
      Objects.equals(
        this.maxAnalyticsRangeDays,
        tenantPlanResponseDto.maxAnalyticsRangeDays
      ) &&
      Objects.equals(this.prices, tenantPlanResponseDto.prices)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      name,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget,
      aiModelTier,
      maxDocumentBytes,
      maxAttachmentBytes,
      maxDocumentUploads,
      maxAnalyticsRangeDays,
      prices
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TenantPlanResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
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
    sb.append("    prices: ").append(toIndentedString(prices)).append("\n");
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

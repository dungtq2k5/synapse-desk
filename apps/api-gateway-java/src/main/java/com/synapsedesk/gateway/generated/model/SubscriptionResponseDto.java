package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * SubscriptionResponseDto
 */

public class SubscriptionResponseDto {

  private String stripeCustomerId = null;

  private String stripeSubscriptionId = null;

  private String planName;

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
      return null;
    }
  }

  private AiModelTierEnum aiModelTier = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime billingCycleStart = null;

  /**
   * `OrgStatus` — **ours, not Stripe's**, despite living on a subscription response. The proto field is `OrgStatus` and its comment says so: *\"the tenant lifecycle status the subscription drove\"*. Only the neighbouring `InvoiceResponseDto.status` carries Stripe's vocabulary.
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

  public SubscriptionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SubscriptionResponseDto(String stripeCustomerId, String stripeSubscriptionId, String planName, BigDecimal maxAgentSeats, BigDecimal maxStorageBytes, BigDecimal monthlyAiTokenBudget, AiModelTierEnum aiModelTier, OffsetDateTime billingCycleStart, StatusEnum status) {
    this.stripeCustomerId = stripeCustomerId;
    this.stripeSubscriptionId = stripeSubscriptionId;
    this.planName = planName;
    this.maxAgentSeats = maxAgentSeats;
    this.maxStorageBytes = maxStorageBytes;
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    this.aiModelTier = aiModelTier;
    this.billingCycleStart = billingCycleStart;
    this.status = status;
  }

  public SubscriptionResponseDto stripeCustomerId(String stripeCustomerId) {
    this.stripeCustomerId = stripeCustomerId;
    return this;
  }

  /**
   * NULL for a grandfathered tenant — free, internal, or pre-billing.
   * @return stripeCustomerId
   */
  
  @JsonProperty("stripeCustomerId")
  public String getStripeCustomerId() {
    return stripeCustomerId;
  }

  @JsonProperty("stripeCustomerId")
  public void setStripeCustomerId(String stripeCustomerId) {
    this.stripeCustomerId = stripeCustomerId;
  }

  public SubscriptionResponseDto stripeSubscriptionId(String stripeSubscriptionId) {
    this.stripeSubscriptionId = stripeSubscriptionId;
    return this;
  }

  /**
   * Get stripeSubscriptionId
   * @return stripeSubscriptionId
   */
  
  @JsonProperty("stripeSubscriptionId")
  public String getStripeSubscriptionId() {
    return stripeSubscriptionId;
  }

  @JsonProperty("stripeSubscriptionId")
  public void setStripeSubscriptionId(String stripeSubscriptionId) {
    this.stripeSubscriptionId = stripeSubscriptionId;
  }

  public SubscriptionResponseDto planName(String planName) {
    this.planName = planName;
    return this;
  }

  /**
   * A label. Never an authorization input.
   * @return planName
   */
  @NotNull 
  @JsonProperty("planName")
  public String getPlanName() {
    return planName;
  }

  @JsonProperty("planName")
  public void setPlanName(String planName) {
    this.planName = planName;
  }

  public SubscriptionResponseDto maxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * @return maxAgentSeats
   */
  @NotNull @Valid 
  @JsonProperty("maxAgentSeats")
  public BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public SubscriptionResponseDto maxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * @return maxStorageBytes
   */
  @NotNull @Valid 
  @JsonProperty("maxStorageBytes")
  public BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public SubscriptionResponseDto monthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * @return monthlyAiTokenBudget
   */
  @NotNull @Valid 
  @JsonProperty("monthlyAiTokenBudget")
  public BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  public SubscriptionResponseDto aiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * Get aiModelTier
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

  public SubscriptionResponseDto billingCycleStart(OffsetDateTime billingCycleStart) {
    this.billingCycleStart = billingCycleStart;
    return this;
  }

  /**
   * Get billingCycleStart
   * @return billingCycleStart
   */
  @Valid 
  @JsonProperty("billingCycleStart")
  public OffsetDateTime getBillingCycleStart() {
    return billingCycleStart;
  }

  @JsonProperty("billingCycleStart")
  public void setBillingCycleStart(OffsetDateTime billingCycleStart) {
    this.billingCycleStart = billingCycleStart;
  }

  public SubscriptionResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `OrgStatus` — **ours, not Stripe's**, despite living on a subscription response. The proto field is `OrgStatus` and its comment says so: *\"the tenant lifecycle status the subscription drove\"*. Only the neighbouring `InvoiceResponseDto.status` carries Stripe's vocabulary.
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
    SubscriptionResponseDto subscriptionResponseDto = (SubscriptionResponseDto) o;
    return Objects.equals(this.stripeCustomerId, subscriptionResponseDto.stripeCustomerId) &&
        Objects.equals(this.stripeSubscriptionId, subscriptionResponseDto.stripeSubscriptionId) &&
        Objects.equals(this.planName, subscriptionResponseDto.planName) &&
        Objects.equals(this.maxAgentSeats, subscriptionResponseDto.maxAgentSeats) &&
        Objects.equals(this.maxStorageBytes, subscriptionResponseDto.maxStorageBytes) &&
        Objects.equals(this.monthlyAiTokenBudget, subscriptionResponseDto.monthlyAiTokenBudget) &&
        Objects.equals(this.aiModelTier, subscriptionResponseDto.aiModelTier) &&
        Objects.equals(this.billingCycleStart, subscriptionResponseDto.billingCycleStart) &&
        Objects.equals(this.status, subscriptionResponseDto.status);
  }

  @Override
  public int hashCode() {
    return Objects.hash(stripeCustomerId, stripeSubscriptionId, planName, maxAgentSeats, maxStorageBytes, monthlyAiTokenBudget, aiModelTier, billingCycleStart, status);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SubscriptionResponseDto {\n");
    sb.append("    stripeCustomerId: ").append(toIndentedString(stripeCustomerId)).append("\n");
    sb.append("    stripeSubscriptionId: ").append(toIndentedString(stripeSubscriptionId)).append("\n");
    sb.append("    planName: ").append(toIndentedString(planName)).append("\n");
    sb.append("    maxAgentSeats: ").append(toIndentedString(maxAgentSeats)).append("\n");
    sb.append("    maxStorageBytes: ").append(toIndentedString(maxStorageBytes)).append("\n");
    sb.append("    monthlyAiTokenBudget: ").append(toIndentedString(monthlyAiTokenBudget)).append("\n");
    sb.append("    aiModelTier: ").append(toIndentedString(aiModelTier)).append("\n");
    sb.append("    billingCycleStart: ").append(toIndentedString(billingCycleStart)).append("\n");
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


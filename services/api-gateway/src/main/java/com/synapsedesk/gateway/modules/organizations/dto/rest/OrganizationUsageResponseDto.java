package com.synapsedesk.gateway.modules.organizations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.modules.organizations.dto.rest.UsageMeterResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * OrganizationUsageResponseDto
 */

public class OrganizationUsageResponseDto {

  private UsageMeterResponseDto seats;

  private UsageMeterResponseDto storage;

  private UsageMeterResponseDto aiTokens;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime billingCycleStart;

  /**
   * The plan, beside the meters  This is the page a customer opens when they hit a limit, and a limit with no plan next to it is a number they cannot act on: the next question is always \"what would I get if I upgraded\".
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

  private String planName;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime currentPeriodEnd = null;

  public OrganizationUsageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OrganizationUsageResponseDto(
    UsageMeterResponseDto seats,
    UsageMeterResponseDto storage,
    UsageMeterResponseDto aiTokens,
    OffsetDateTime billingCycleStart,
    AiModelTierEnum aiModelTier,
    String planName,
    OffsetDateTime currentPeriodEnd
  ) {
    this.seats = seats;
    this.storage = storage;
    this.aiTokens = aiTokens;
    this.billingCycleStart = billingCycleStart;
    this.aiModelTier = aiModelTier;
    this.planName = planName;
    this.currentPeriodEnd = currentPeriodEnd;
  }

  public OrganizationUsageResponseDto seats(UsageMeterResponseDto seats) {
    this.seats = seats;
    return this;
  }

  /**
   * Get seats
   * @return seats
   */
  @NotNull
  @Valid
  @JsonProperty("seats")
  public UsageMeterResponseDto getSeats() {
    return seats;
  }

  @JsonProperty("seats")
  public void setSeats(UsageMeterResponseDto seats) {
    this.seats = seats;
  }

  public OrganizationUsageResponseDto storage(UsageMeterResponseDto storage) {
    this.storage = storage;
    return this;
  }

  /**
   * Composed at the GATEWAY from ingestion's tenant-scoped usage read.  auth-service cannot answer it — it does not count documents and cannot dial the service that does — so it sends this meter unavailable and the gateway replaces it. `available: false` here therefore means the ingestion leg did not answer, and never \"this workspace has no storage\".  The number is the one a plan-change refusal quotes. It has to be: a tenant told to reduce storage opens this page to find out what to delete.
   * @return storage
   */
  @NotNull
  @Valid
  @JsonProperty("storage")
  public UsageMeterResponseDto getStorage() {
    return storage;
  }

  @JsonProperty("storage")
  public void setStorage(UsageMeterResponseDto storage) {
    this.storage = storage;
  }

  public OrganizationUsageResponseDto aiTokens(UsageMeterResponseDto aiTokens) {
    this.aiTokens = aiTokens;
    return this;
  }

  /**
   * Get aiTokens
   * @return aiTokens
   */
  @NotNull
  @Valid
  @JsonProperty("aiTokens")
  public UsageMeterResponseDto getAiTokens() {
    return aiTokens;
  }

  @JsonProperty("aiTokens")
  public void setAiTokens(UsageMeterResponseDto aiTokens) {
    this.aiTokens = aiTokens;
  }

  public OrganizationUsageResponseDto billingCycleStart(
    OffsetDateTime billingCycleStart
  ) {
    this.billingCycleStart = billingCycleStart;
    return this;
  }

  /**
   * Get billingCycleStart
   * @return billingCycleStart
   */
  @NotNull
  @Valid
  @JsonProperty("billingCycleStart")
  public OffsetDateTime getBillingCycleStart() {
    return billingCycleStart;
  }

  @JsonProperty("billingCycleStart")
  public void setBillingCycleStart(OffsetDateTime billingCycleStart) {
    this.billingCycleStart = billingCycleStart;
  }

  public OrganizationUsageResponseDto aiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * The plan, beside the meters  This is the page a customer opens when they hit a limit, and a limit with no plan next to it is a number they cannot act on: the next question is always \"what would I get if I upgraded\".
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

  public OrganizationUsageResponseDto planName(String planName) {
    this.planName = planName;
    return this;
  }

  /**
   * Get planName
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

  public OrganizationUsageResponseDto currentPeriodEnd(
    OffsetDateTime currentPeriodEnd
  ) {
    this.currentPeriodEnd = currentPeriodEnd;
    return this;
  }

  /**
   * NULL for a grandfathered tenant, who has no invoice period at all.
   * @return currentPeriodEnd
   */
  @Valid
  @JsonProperty("currentPeriodEnd")
  public OffsetDateTime getCurrentPeriodEnd() {
    return currentPeriodEnd;
  }

  @JsonProperty("currentPeriodEnd")
  public void setCurrentPeriodEnd(OffsetDateTime currentPeriodEnd) {
    this.currentPeriodEnd = currentPeriodEnd;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OrganizationUsageResponseDto organizationUsageResponseDto =
      (OrganizationUsageResponseDto) o;
    return (
      Objects.equals(this.seats, organizationUsageResponseDto.seats) &&
      Objects.equals(this.storage, organizationUsageResponseDto.storage) &&
      Objects.equals(this.aiTokens, organizationUsageResponseDto.aiTokens) &&
      Objects.equals(
        this.billingCycleStart,
        organizationUsageResponseDto.billingCycleStart
      ) &&
      Objects.equals(
        this.aiModelTier,
        organizationUsageResponseDto.aiModelTier
      ) &&
      Objects.equals(this.planName, organizationUsageResponseDto.planName) &&
      Objects.equals(
        this.currentPeriodEnd,
        organizationUsageResponseDto.currentPeriodEnd
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      seats,
      storage,
      aiTokens,
      billingCycleStart,
      aiModelTier,
      planName,
      currentPeriodEnd
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OrganizationUsageResponseDto {\n");
    sb.append("    seats: ").append(toIndentedString(seats)).append("\n");
    sb.append("    storage: ").append(toIndentedString(storage)).append("\n");
    sb.append("    aiTokens: ").append(toIndentedString(aiTokens)).append("\n");
    sb.append("    billingCycleStart: ")
      .append(toIndentedString(billingCycleStart))
      .append("\n");
    sb.append("    aiModelTier: ")
      .append(toIndentedString(aiModelTier))
      .append("\n");
    sb.append("    planName: ").append(toIndentedString(planName)).append("\n");
    sb.append("    currentPeriodEnd: ")
      .append(toIndentedString(currentPeriodEnd))
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

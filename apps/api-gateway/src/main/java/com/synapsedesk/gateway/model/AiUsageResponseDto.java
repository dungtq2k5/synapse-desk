package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.model.AiUsagePointResponseDto;
import com.synapsedesk.gateway.model.AiUsageSliceResponseDto;
import com.synapsedesk.gateway.model.RateResponseDto;
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
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * AiUsageResponseDto
 */

public class AiUsageResponseDto {

  private List<@Valid AiUsagePointResponseDto> points = new ArrayList<>();

  private List<@Valid AiUsageSliceResponseDto> byPurpose = new ArrayList<>();

  private List<@Valid AiUsageSliceResponseDto> byModel = new ArrayList<>();

  private BigDecimal totalCostMicros;

  private BigDecimal totalGenerations;

  private BigDecimal monthlyBudgetMicros;

  /**
   * `FAST` | `QUALITY`, or null.  The wire field was a bare `string` while `billing.proto` spelled the same fact as `AiModelTier` — drift rather than a decision, and it is an enum on both now. Null only for UNSPECIFIED, which means auth-service returned no entitlement.
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

  private RateResponseDto draftAcceptance;

  private RateResponseDto emptyRetrievalRate;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime computedAt = null;

  private String dataThrough = null;

  public AiUsageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiUsageResponseDto(
    List<@Valid AiUsagePointResponseDto> points,
    List<@Valid AiUsageSliceResponseDto> byPurpose,
    List<@Valid AiUsageSliceResponseDto> byModel,
    BigDecimal totalCostMicros,
    BigDecimal totalGenerations,
    BigDecimal monthlyBudgetMicros,
    AiModelTierEnum aiModelTier,
    RateResponseDto draftAcceptance,
    RateResponseDto emptyRetrievalRate,
    OffsetDateTime computedAt,
    String dataThrough
  ) {
    this.points = points;
    this.byPurpose = byPurpose;
    this.byModel = byModel;
    this.totalCostMicros = totalCostMicros;
    this.totalGenerations = totalGenerations;
    this.monthlyBudgetMicros = monthlyBudgetMicros;
    this.aiModelTier = aiModelTier;
    this.draftAcceptance = draftAcceptance;
    this.emptyRetrievalRate = emptyRetrievalRate;
    this.computedAt = computedAt;
    this.dataThrough = dataThrough;
  }

  public AiUsageResponseDto points(
    List<@Valid AiUsagePointResponseDto> points
  ) {
    this.points = points;
    return this;
  }

  public AiUsageResponseDto addPointsItem(AiUsagePointResponseDto pointsItem) {
    if (this.points == null) {
      this.points = new ArrayList<>();
    }
    this.points.add(pointsItem);
    return this;
  }

  /**
   * Get points
   * @return points
   */
  @NotNull
  @Valid
  @JsonProperty("points")
  public List<@Valid AiUsagePointResponseDto> getPoints() {
    return points;
  }

  @JsonProperty("points")
  public void setPoints(List<@Valid AiUsagePointResponseDto> points) {
    this.points = points;
  }

  public AiUsageResponseDto byPurpose(
    List<@Valid AiUsageSliceResponseDto> byPurpose
  ) {
    this.byPurpose = byPurpose;
    return this;
  }

  public AiUsageResponseDto addByPurposeItem(
    AiUsageSliceResponseDto byPurposeItem
  ) {
    if (this.byPurpose == null) {
      this.byPurpose = new ArrayList<>();
    }
    this.byPurpose.add(byPurposeItem);
    return this;
  }

  /**
   * **The per-purpose split is the point** — where the budget actually goes.
   * @return byPurpose
   */
  @NotNull
  @Valid
  @JsonProperty("byPurpose")
  public List<@Valid AiUsageSliceResponseDto> getByPurpose() {
    return byPurpose;
  }

  @JsonProperty("byPurpose")
  public void setByPurpose(List<@Valid AiUsageSliceResponseDto> byPurpose) {
    this.byPurpose = byPurpose;
  }

  public AiUsageResponseDto byModel(
    List<@Valid AiUsageSliceResponseDto> byModel
  ) {
    this.byModel = byModel;
    return this;
  }

  public AiUsageResponseDto addByModelItem(
    AiUsageSliceResponseDto byModelItem
  ) {
    if (this.byModel == null) {
      this.byModel = new ArrayList<>();
    }
    this.byModel.add(byModelItem);
    return this;
  }

  /**
   * Get byModel
   * @return byModel
   */
  @NotNull
  @Valid
  @JsonProperty("byModel")
  public List<@Valid AiUsageSliceResponseDto> getByModel() {
    return byModel;
  }

  @JsonProperty("byModel")
  public void setByModel(List<@Valid AiUsageSliceResponseDto> byModel) {
    this.byModel = byModel;
  }

  public AiUsageResponseDto totalCostMicros(BigDecimal totalCostMicros) {
    this.totalCostMicros = totalCostMicros;
    return this;
  }

  /**
   * Get totalCostMicros
   * @return totalCostMicros
   */
  @NotNull
  @Valid
  @JsonProperty("totalCostMicros")
  public BigDecimal getTotalCostMicros() {
    return totalCostMicros;
  }

  @JsonProperty("totalCostMicros")
  public void setTotalCostMicros(BigDecimal totalCostMicros) {
    this.totalCostMicros = totalCostMicros;
  }

  public AiUsageResponseDto totalGenerations(BigDecimal totalGenerations) {
    this.totalGenerations = totalGenerations;
    return this;
  }

  /**
   * Get totalGenerations
   * @return totalGenerations
   */
  @NotNull
  @Valid
  @JsonProperty("totalGenerations")
  public BigDecimal getTotalGenerations() {
    return totalGenerations;
  }

  @JsonProperty("totalGenerations")
  public void setTotalGenerations(BigDecimal totalGenerations) {
    this.totalGenerations = totalGenerations;
  }

  public AiUsageResponseDto monthlyBudgetMicros(
    BigDecimal monthlyBudgetMicros
  ) {
    this.monthlyBudgetMicros = monthlyBudgetMicros;
    return this;
  }

  /**
   * Get monthlyBudgetMicros
   * @return monthlyBudgetMicros
   */
  @NotNull
  @Valid
  @JsonProperty("monthlyBudgetMicros")
  public BigDecimal getMonthlyBudgetMicros() {
    return monthlyBudgetMicros;
  }

  @JsonProperty("monthlyBudgetMicros")
  public void setMonthlyBudgetMicros(BigDecimal monthlyBudgetMicros) {
    this.monthlyBudgetMicros = monthlyBudgetMicros;
  }

  public AiUsageResponseDto aiModelTier(AiModelTierEnum aiModelTier) {
    this.aiModelTier = aiModelTier;
    return this;
  }

  /**
   * `FAST` | `QUALITY`, or null.  The wire field was a bare `string` while `billing.proto` spelled the same fact as `AiModelTier` — drift rather than a decision, and it is an enum on both now. Null only for UNSPECIFIED, which means auth-service returned no entitlement.
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

  public AiUsageResponseDto draftAcceptance(RateResponseDto draftAcceptance) {
    this.draftAcceptance = draftAcceptance;
    return this;
  }

  /**
   * Get draftAcceptance
   * @return draftAcceptance
   */
  @NotNull
  @Valid
  @JsonProperty("draftAcceptance")
  public RateResponseDto getDraftAcceptance() {
    return draftAcceptance;
  }

  @JsonProperty("draftAcceptance")
  public void setDraftAcceptance(RateResponseDto draftAcceptance) {
    this.draftAcceptance = draftAcceptance;
  }

  public AiUsageResponseDto emptyRetrievalRate(
    RateResponseDto emptyRetrievalRate
  ) {
    this.emptyRetrievalRate = emptyRetrievalRate;
    return this;
  }

  /**
   * Get emptyRetrievalRate
   * @return emptyRetrievalRate
   */
  @NotNull
  @Valid
  @JsonProperty("emptyRetrievalRate")
  public RateResponseDto getEmptyRetrievalRate() {
    return emptyRetrievalRate;
  }

  @JsonProperty("emptyRetrievalRate")
  public void setEmptyRetrievalRate(RateResponseDto emptyRetrievalRate) {
    this.emptyRetrievalRate = emptyRetrievalRate;
  }

  public AiUsageResponseDto computedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
    return this;
  }

  /**
   * Get computedAt
   * @return computedAt
   */
  @Valid
  @JsonProperty("computedAt")
  public OffsetDateTime getComputedAt() {
    return computedAt;
  }

  @JsonProperty("computedAt")
  public void setComputedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
  }

  public AiUsageResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * See `OverviewResponseDto.dataThrough`.
   * @return dataThrough
   */

  @JsonProperty("dataThrough")
  public String getDataThrough() {
    return dataThrough;
  }

  @JsonProperty("dataThrough")
  public void setDataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiUsageResponseDto aiUsageResponseDto = (AiUsageResponseDto) o;
    return (
      Objects.equals(this.points, aiUsageResponseDto.points) &&
      Objects.equals(this.byPurpose, aiUsageResponseDto.byPurpose) &&
      Objects.equals(this.byModel, aiUsageResponseDto.byModel) &&
      Objects.equals(
        this.totalCostMicros,
        aiUsageResponseDto.totalCostMicros
      ) &&
      Objects.equals(
        this.totalGenerations,
        aiUsageResponseDto.totalGenerations
      ) &&
      Objects.equals(
        this.monthlyBudgetMicros,
        aiUsageResponseDto.monthlyBudgetMicros
      ) &&
      Objects.equals(this.aiModelTier, aiUsageResponseDto.aiModelTier) &&
      Objects.equals(
        this.draftAcceptance,
        aiUsageResponseDto.draftAcceptance
      ) &&
      Objects.equals(
        this.emptyRetrievalRate,
        aiUsageResponseDto.emptyRetrievalRate
      ) &&
      Objects.equals(this.computedAt, aiUsageResponseDto.computedAt) &&
      Objects.equals(this.dataThrough, aiUsageResponseDto.dataThrough)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      points,
      byPurpose,
      byModel,
      totalCostMicros,
      totalGenerations,
      monthlyBudgetMicros,
      aiModelTier,
      draftAcceptance,
      emptyRetrievalRate,
      computedAt,
      dataThrough
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiUsageResponseDto {\n");
    sb.append("    points: ").append(toIndentedString(points)).append("\n");
    sb.append("    byPurpose: ")
      .append(toIndentedString(byPurpose))
      .append("\n");
    sb.append("    byModel: ").append(toIndentedString(byModel)).append("\n");
    sb.append("    totalCostMicros: ")
      .append(toIndentedString(totalCostMicros))
      .append("\n");
    sb.append("    totalGenerations: ")
      .append(toIndentedString(totalGenerations))
      .append("\n");
    sb.append("    monthlyBudgetMicros: ")
      .append(toIndentedString(monthlyBudgetMicros))
      .append("\n");
    sb.append("    aiModelTier: ")
      .append(toIndentedString(aiModelTier))
      .append("\n");
    sb.append("    draftAcceptance: ")
      .append(toIndentedString(draftAcceptance))
      .append("\n");
    sb.append("    emptyRetrievalRate: ")
      .append(toIndentedString(emptyRetrievalRate))
      .append("\n");
    sb.append("    computedAt: ")
      .append(toIndentedString(computedAt))
      .append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
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

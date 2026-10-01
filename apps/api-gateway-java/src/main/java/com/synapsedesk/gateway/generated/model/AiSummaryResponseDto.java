package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * AiSummaryResponseDto
 */

public class AiSummaryResponseDto {

  private String id;

  private String ticketId;

  private String summaryText;

  private String suggestedAction;

  private BigDecimal confidenceScore;

  private String modelName;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public AiSummaryResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiSummaryResponseDto(String id, String ticketId, String summaryText, String suggestedAction, BigDecimal confidenceScore, String modelName, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    this.id = id;
    this.ticketId = ticketId;
    this.summaryText = summaryText;
    this.suggestedAction = suggestedAction;
    this.confidenceScore = confidenceScore;
    this.modelName = modelName;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public AiSummaryResponseDto id(String id) {
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

  public AiSummaryResponseDto ticketId(String ticketId) {
    this.ticketId = ticketId;
    return this;
  }

  /**
   * Get ticketId
   * @return ticketId
   */
  @NotNull 
  @JsonProperty("ticketId")
  public String getTicketId() {
    return ticketId;
  }

  @JsonProperty("ticketId")
  public void setTicketId(String ticketId) {
    this.ticketId = ticketId;
  }

  public AiSummaryResponseDto summaryText(String summaryText) {
    this.summaryText = summaryText;
    return this;
  }

  /**
   * Get summaryText
   * @return summaryText
   */
  @NotNull 
  @JsonProperty("summaryText")
  public String getSummaryText() {
    return summaryText;
  }

  @JsonProperty("summaryText")
  public void setSummaryText(String summaryText) {
    this.summaryText = summaryText;
  }

  public AiSummaryResponseDto suggestedAction(String suggestedAction) {
    this.suggestedAction = suggestedAction;
    return this;
  }

  /**
   * Get suggestedAction
   * @return suggestedAction
   */
  @NotNull 
  @JsonProperty("suggestedAction")
  public String getSuggestedAction() {
    return suggestedAction;
  }

  @JsonProperty("suggestedAction")
  public void setSuggestedAction(String suggestedAction) {
    this.suggestedAction = suggestedAction;
  }

  public AiSummaryResponseDto confidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
    return this;
  }

  /**
   * Get confidenceScore
   * @return confidenceScore
   */
  @NotNull @Valid 
  @JsonProperty("confidenceScore")
  public BigDecimal getConfidenceScore() {
    return confidenceScore;
  }

  @JsonProperty("confidenceScore")
  public void setConfidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
  }

  public AiSummaryResponseDto modelName(String modelName) {
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

  public AiSummaryResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull @Valid 
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public AiSummaryResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull @Valid 
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiSummaryResponseDto aiSummaryResponseDto = (AiSummaryResponseDto) o;
    return Objects.equals(this.id, aiSummaryResponseDto.id) &&
        Objects.equals(this.ticketId, aiSummaryResponseDto.ticketId) &&
        Objects.equals(this.summaryText, aiSummaryResponseDto.summaryText) &&
        Objects.equals(this.suggestedAction, aiSummaryResponseDto.suggestedAction) &&
        Objects.equals(this.confidenceScore, aiSummaryResponseDto.confidenceScore) &&
        Objects.equals(this.modelName, aiSummaryResponseDto.modelName) &&
        Objects.equals(this.createdAt, aiSummaryResponseDto.createdAt) &&
        Objects.equals(this.updatedAt, aiSummaryResponseDto.updatedAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, ticketId, summaryText, suggestedAction, confidenceScore, modelName, createdAt, updatedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiSummaryResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    summaryText: ").append(toIndentedString(summaryText)).append("\n");
    sb.append("    suggestedAction: ").append(toIndentedString(suggestedAction)).append("\n");
    sb.append("    confidenceScore: ").append(toIndentedString(confidenceScore)).append("\n");
    sb.append("    modelName: ").append(toIndentedString(modelName)).append("\n");
    sb.append("    createdAt: ").append(toIndentedString(createdAt)).append("\n");
    sb.append("    updatedAt: ").append(toIndentedString(updatedAt)).append("\n");
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


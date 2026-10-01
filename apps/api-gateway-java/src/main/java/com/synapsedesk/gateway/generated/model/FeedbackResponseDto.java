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
 * FeedbackResponseDto
 */

public class FeedbackResponseDto {

  /**
   * Gets or Sets rating
   */
  public enum RatingEnum {
    NUMBER_MINUS_1(new BigDecimal("-1")),
    
    NUMBER_1(new BigDecimal("1"));

    private final BigDecimal value;

    RatingEnum(BigDecimal value) {
      this.value = value;
    }

    @JsonValue
    public BigDecimal getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static RatingEnum fromValue(BigDecimal value) {
      for (RatingEnum b : RatingEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private RatingEnum rating;

  private String id;

  private String ticketMessageId;

  private String userId;

  private String organizationId;

  private String feedbackText = null;

  private Boolean citationAccurate = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public FeedbackResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public FeedbackResponseDto(RatingEnum rating, String id, String ticketMessageId, String userId, String organizationId, String feedbackText, Boolean citationAccurate, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    this.rating = rating;
    this.id = id;
    this.ticketMessageId = ticketMessageId;
    this.userId = userId;
    this.organizationId = organizationId;
    this.feedbackText = feedbackText;
    this.citationAccurate = citationAccurate;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public FeedbackResponseDto rating(RatingEnum rating) {
    this.rating = rating;
    return this;
  }

  /**
   * Get rating
   * @return rating
   */
  @NotNull @Valid 
  @JsonProperty("rating")
  public RatingEnum getRating() {
    return rating;
  }

  @JsonProperty("rating")
  public void setRating(RatingEnum rating) {
    this.rating = rating;
  }

  public FeedbackResponseDto id(String id) {
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

  public FeedbackResponseDto ticketMessageId(String ticketMessageId) {
    this.ticketMessageId = ticketMessageId;
    return this;
  }

  /**
   * Get ticketMessageId
   * @return ticketMessageId
   */
  @NotNull 
  @JsonProperty("ticketMessageId")
  public String getTicketMessageId() {
    return ticketMessageId;
  }

  @JsonProperty("ticketMessageId")
  public void setTicketMessageId(String ticketMessageId) {
    this.ticketMessageId = ticketMessageId;
  }

  public FeedbackResponseDto userId(String userId) {
    this.userId = userId;
    return this;
  }

  /**
   * Get userId
   * @return userId
   */
  @NotNull 
  @JsonProperty("userId")
  public String getUserId() {
    return userId;
  }

  @JsonProperty("userId")
  public void setUserId(String userId) {
    this.userId = userId;
  }

  public FeedbackResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull 
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public FeedbackResponseDto feedbackText(String feedbackText) {
    this.feedbackText = feedbackText;
    return this;
  }

  /**
   * Get feedbackText
   * @return feedbackText
   */
  
  @JsonProperty("feedbackText")
  public String getFeedbackText() {
    return feedbackText;
  }

  @JsonProperty("feedbackText")
  public void setFeedbackText(String feedbackText) {
    this.feedbackText = feedbackText;
  }

  public FeedbackResponseDto citationAccurate(Boolean citationAccurate) {
    this.citationAccurate = citationAccurate;
    return this;
  }

  /**
   * null means \"not assessed\", NOT \"assessed and wrong\".
   * @return citationAccurate
   */
  
  @JsonProperty("citationAccurate")
  public Boolean getCitationAccurate() {
    return citationAccurate;
  }

  @JsonProperty("citationAccurate")
  public void setCitationAccurate(Boolean citationAccurate) {
    this.citationAccurate = citationAccurate;
  }

  public FeedbackResponseDto createdAt(OffsetDateTime createdAt) {
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

  public FeedbackResponseDto updatedAt(OffsetDateTime updatedAt) {
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
    FeedbackResponseDto feedbackResponseDto = (FeedbackResponseDto) o;
    return Objects.equals(this.rating, feedbackResponseDto.rating) &&
        Objects.equals(this.id, feedbackResponseDto.id) &&
        Objects.equals(this.ticketMessageId, feedbackResponseDto.ticketMessageId) &&
        Objects.equals(this.userId, feedbackResponseDto.userId) &&
        Objects.equals(this.organizationId, feedbackResponseDto.organizationId) &&
        Objects.equals(this.feedbackText, feedbackResponseDto.feedbackText) &&
        Objects.equals(this.citationAccurate, feedbackResponseDto.citationAccurate) &&
        Objects.equals(this.createdAt, feedbackResponseDto.createdAt) &&
        Objects.equals(this.updatedAt, feedbackResponseDto.updatedAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(rating, id, ticketMessageId, userId, organizationId, feedbackText, citationAccurate, createdAt, updatedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class FeedbackResponseDto {\n");
    sb.append("    rating: ").append(toIndentedString(rating)).append("\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketMessageId: ").append(toIndentedString(ticketMessageId)).append("\n");
    sb.append("    userId: ").append(toIndentedString(userId)).append("\n");
    sb.append("    organizationId: ").append(toIndentedString(organizationId)).append("\n");
    sb.append("    feedbackText: ").append(toIndentedString(feedbackText)).append("\n");
    sb.append("    citationAccurate: ").append(toIndentedString(citationAccurate)).append("\n");
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


package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * SimilarTicketResponseDto
 */

public class SimilarTicketResponseDto {

  private String ticketId;

  private BigDecimal ticketNumber;

  private String title;

  private BigDecimal similarityScore;

  public SimilarTicketResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SimilarTicketResponseDto(String ticketId, BigDecimal ticketNumber, String title, BigDecimal similarityScore) {
    this.ticketId = ticketId;
    this.ticketNumber = ticketNumber;
    this.title = title;
    this.similarityScore = similarityScore;
  }

  public SimilarTicketResponseDto ticketId(String ticketId) {
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

  public SimilarTicketResponseDto ticketNumber(BigDecimal ticketNumber) {
    this.ticketNumber = ticketNumber;
    return this;
  }

  /**
   * Get ticketNumber
   * @return ticketNumber
   */
  @NotNull @Valid 
  @JsonProperty("ticketNumber")
  public BigDecimal getTicketNumber() {
    return ticketNumber;
  }

  @JsonProperty("ticketNumber")
  public void setTicketNumber(BigDecimal ticketNumber) {
    this.ticketNumber = ticketNumber;
  }

  public SimilarTicketResponseDto title(String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @NotNull 
  @JsonProperty("title")
  public String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(String title) {
    this.title = title;
  }

  public SimilarTicketResponseDto similarityScore(BigDecimal similarityScore) {
    this.similarityScore = similarityScore;
    return this;
  }

  /**
   * Get similarityScore
   * @return similarityScore
   */
  @NotNull @Valid 
  @JsonProperty("similarityScore")
  public BigDecimal getSimilarityScore() {
    return similarityScore;
  }

  @JsonProperty("similarityScore")
  public void setSimilarityScore(BigDecimal similarityScore) {
    this.similarityScore = similarityScore;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SimilarTicketResponseDto similarTicketResponseDto = (SimilarTicketResponseDto) o;
    return Objects.equals(this.ticketId, similarTicketResponseDto.ticketId) &&
        Objects.equals(this.ticketNumber, similarTicketResponseDto.ticketNumber) &&
        Objects.equals(this.title, similarTicketResponseDto.title) &&
        Objects.equals(this.similarityScore, similarTicketResponseDto.similarityScore);
  }

  @Override
  public int hashCode() {
    return Objects.hash(ticketId, ticketNumber, title, similarityScore);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SimilarTicketResponseDto {\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    ticketNumber: ").append(toIndentedString(ticketNumber)).append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    similarityScore: ").append(toIndentedString(similarityScore)).append("\n");
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


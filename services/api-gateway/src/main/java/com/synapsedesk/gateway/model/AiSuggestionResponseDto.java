package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AiSuggestionResponseDto
 */

public class AiSuggestionResponseDto {

  private String title;

  private String body;

  private BigDecimal confidenceScore;

  public AiSuggestionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiSuggestionResponseDto(
    String title,
    String body,
    BigDecimal confidenceScore
  ) {
    this.title = title;
    this.body = body;
    this.confidenceScore = confidenceScore;
  }

  public AiSuggestionResponseDto title(String title) {
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

  public AiSuggestionResponseDto body(String body) {
    this.body = body;
    return this;
  }

  /**
   * Get body
   * @return body
   */
  @NotNull
  @JsonProperty("body")
  public String getBody() {
    return body;
  }

  @JsonProperty("body")
  public void setBody(String body) {
    this.body = body;
  }

  public AiSuggestionResponseDto confidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
    return this;
  }

  /**
   * Get confidenceScore
   * @return confidenceScore
   */
  @NotNull
  @Valid
  @JsonProperty("confidenceScore")
  public BigDecimal getConfidenceScore() {
    return confidenceScore;
  }

  @JsonProperty("confidenceScore")
  public void setConfidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiSuggestionResponseDto aiSuggestionResponseDto =
      (AiSuggestionResponseDto) o;
    return (
      Objects.equals(this.title, aiSuggestionResponseDto.title) &&
      Objects.equals(this.body, aiSuggestionResponseDto.body) &&
      Objects.equals(
        this.confidenceScore,
        aiSuggestionResponseDto.confidenceScore
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(title, body, confidenceScore);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiSuggestionResponseDto {\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    body: ").append(toIndentedString(body)).append("\n");
    sb.append("    confidenceScore: ")
      .append(toIndentedString(confidenceScore))
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

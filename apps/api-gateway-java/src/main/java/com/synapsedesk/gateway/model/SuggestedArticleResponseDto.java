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
 * SuggestedArticleResponseDto
 */

public class SuggestedArticleResponseDto {

  private String documentId;

  private String documentTitle;

  private BigDecimal pageNumber = null;

  private BigDecimal score;

  public SuggestedArticleResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SuggestedArticleResponseDto(
    String documentId,
    String documentTitle,
    BigDecimal pageNumber,
    BigDecimal score
  ) {
    this.documentId = documentId;
    this.documentTitle = documentTitle;
    this.pageNumber = pageNumber;
    this.score = score;
  }

  public SuggestedArticleResponseDto documentId(String documentId) {
    this.documentId = documentId;
    return this;
  }

  /**
   * Get documentId
   * @return documentId
   */
  @NotNull
  @JsonProperty("documentId")
  public String getDocumentId() {
    return documentId;
  }

  @JsonProperty("documentId")
  public void setDocumentId(String documentId) {
    this.documentId = documentId;
  }

  public SuggestedArticleResponseDto documentTitle(String documentTitle) {
    this.documentTitle = documentTitle;
    return this;
  }

  /**
   * Get documentTitle
   * @return documentTitle
   */
  @NotNull
  @JsonProperty("documentTitle")
  public String getDocumentTitle() {
    return documentTitle;
  }

  @JsonProperty("documentTitle")
  public void setDocumentTitle(String documentTitle) {
    this.documentTitle = documentTitle;
  }

  public SuggestedArticleResponseDto pageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
    return this;
  }

  /**
   * `null` for a source with no pages — a pasted text file, an HTML article.
   * @return pageNumber
   */
  @Valid
  @JsonProperty("pageNumber")
  public BigDecimal getPageNumber() {
    return pageNumber;
  }

  @JsonProperty("pageNumber")
  public void setPageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
  }

  public SuggestedArticleResponseDto score(BigDecimal score) {
    this.score = score;
    return this;
  }

  /**
   * How well it matched, so a client can show or sort by relevance.
   * @return score
   */
  @NotNull
  @Valid
  @JsonProperty("score")
  public BigDecimal getScore() {
    return score;
  }

  @JsonProperty("score")
  public void setScore(BigDecimal score) {
    this.score = score;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SuggestedArticleResponseDto suggestedArticleResponseDto =
      (SuggestedArticleResponseDto) o;
    return (
      Objects.equals(this.documentId, suggestedArticleResponseDto.documentId) &&
      Objects.equals(
        this.documentTitle,
        suggestedArticleResponseDto.documentTitle
      ) &&
      Objects.equals(this.pageNumber, suggestedArticleResponseDto.pageNumber) &&
      Objects.equals(this.score, suggestedArticleResponseDto.score)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(documentId, documentTitle, pageNumber, score);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SuggestedArticleResponseDto {\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    documentTitle: ")
      .append(toIndentedString(documentTitle))
      .append("\n");
    sb.append("    pageNumber: ")
      .append(toIndentedString(pageNumber))
      .append("\n");
    sb.append("    score: ").append(toIndentedString(score)).append("\n");
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

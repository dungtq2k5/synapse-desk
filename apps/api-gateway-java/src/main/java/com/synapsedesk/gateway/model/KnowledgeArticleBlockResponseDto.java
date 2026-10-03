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
 * KnowledgeArticleBlockResponseDto
 */

public class KnowledgeArticleBlockResponseDto {

  private BigDecimal chunkIndex;

  private BigDecimal pageNumber = null;

  private String contentText;

  public KnowledgeArticleBlockResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeArticleBlockResponseDto(
    BigDecimal chunkIndex,
    BigDecimal pageNumber,
    String contentText
  ) {
    this.chunkIndex = chunkIndex;
    this.pageNumber = pageNumber;
    this.contentText = contentText;
  }

  public KnowledgeArticleBlockResponseDto chunkIndex(BigDecimal chunkIndex) {
    this.chunkIndex = chunkIndex;
    return this;
  }

  /**
   * Get chunkIndex
   * @return chunkIndex
   */
  @NotNull
  @Valid
  @JsonProperty("chunkIndex")
  public BigDecimal getChunkIndex() {
    return chunkIndex;
  }

  @JsonProperty("chunkIndex")
  public void setChunkIndex(BigDecimal chunkIndex) {
    this.chunkIndex = chunkIndex;
  }

  public KnowledgeArticleBlockResponseDto pageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
    return this;
  }

  /**
   * `null` for formats with no pages — never faked as 1.
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

  public KnowledgeArticleBlockResponseDto contentText(String contentText) {
    this.contentText = contentText;
    return this;
  }

  /**
   * Get contentText
   * @return contentText
   */
  @NotNull
  @JsonProperty("contentText")
  public String getContentText() {
    return contentText;
  }

  @JsonProperty("contentText")
  public void setContentText(String contentText) {
    this.contentText = contentText;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeArticleBlockResponseDto knowledgeArticleBlockResponseDto =
      (KnowledgeArticleBlockResponseDto) o;
    return (
      Objects.equals(
        this.chunkIndex,
        knowledgeArticleBlockResponseDto.chunkIndex
      ) &&
      Objects.equals(
        this.pageNumber,
        knowledgeArticleBlockResponseDto.pageNumber
      ) &&
      Objects.equals(
        this.contentText,
        knowledgeArticleBlockResponseDto.contentText
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(chunkIndex, pageNumber, contentText);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeArticleBlockResponseDto {\n");
    sb.append("    chunkIndex: ")
      .append(toIndentedString(chunkIndex))
      .append("\n");
    sb.append("    pageNumber: ")
      .append(toIndentedString(pageNumber))
      .append("\n");
    sb.append("    contentText: ")
      .append(toIndentedString(contentText))
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

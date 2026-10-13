package com.synapsedesk.gateway.modules.knowledge.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * RetrievedChunkResponseDto
 */

public class RetrievedChunkResponseDto {

  private String chunkId;

  private String documentId;

  private String documentTitle;

  private BigDecimal pageNumber = null;

  private BigDecimal chunkIndex;

  private String contentText;

  private BigDecimal score;

  private String vectorPointId;

  public RetrievedChunkResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RetrievedChunkResponseDto(
    String chunkId,
    String documentId,
    String documentTitle,
    BigDecimal pageNumber,
    BigDecimal chunkIndex,
    String contentText,
    BigDecimal score,
    String vectorPointId
  ) {
    this.chunkId = chunkId;
    this.documentId = documentId;
    this.documentTitle = documentTitle;
    this.pageNumber = pageNumber;
    this.chunkIndex = chunkIndex;
    this.contentText = contentText;
    this.score = score;
    this.vectorPointId = vectorPointId;
  }

  public RetrievedChunkResponseDto chunkId(String chunkId) {
    this.chunkId = chunkId;
    return this;
  }

  /**
   * Get chunkId
   * @return chunkId
   */
  @NotNull
  @JsonProperty("chunkId")
  public String getChunkId() {
    return chunkId;
  }

  @JsonProperty("chunkId")
  public void setChunkId(String chunkId) {
    this.chunkId = chunkId;
  }

  public RetrievedChunkResponseDto documentId(String documentId) {
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

  public RetrievedChunkResponseDto documentTitle(String documentTitle) {
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

  public RetrievedChunkResponseDto pageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
    return this;
  }

  /**
   * NULL for formats with no pages — never faked as 1.
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

  public RetrievedChunkResponseDto chunkIndex(BigDecimal chunkIndex) {
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

  public RetrievedChunkResponseDto contentText(String contentText) {
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

  public RetrievedChunkResponseDto score(BigDecimal score) {
    this.score = score;
    return this;
  }

  /**
   * Get score
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

  public RetrievedChunkResponseDto vectorPointId(String vectorPointId) {
    this.vectorPointId = vectorPointId;
    return this;
  }

  /**
   * The id a citation resolves through, and the two arms' fusion key.
   * @return vectorPointId
   */
  @NotNull
  @JsonProperty("vectorPointId")
  public String getVectorPointId() {
    return vectorPointId;
  }

  @JsonProperty("vectorPointId")
  public void setVectorPointId(String vectorPointId) {
    this.vectorPointId = vectorPointId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RetrievedChunkResponseDto retrievedChunkResponseDto =
      (RetrievedChunkResponseDto) o;
    return (
      Objects.equals(this.chunkId, retrievedChunkResponseDto.chunkId) &&
      Objects.equals(this.documentId, retrievedChunkResponseDto.documentId) &&
      Objects.equals(
        this.documentTitle,
        retrievedChunkResponseDto.documentTitle
      ) &&
      Objects.equals(this.pageNumber, retrievedChunkResponseDto.pageNumber) &&
      Objects.equals(this.chunkIndex, retrievedChunkResponseDto.chunkIndex) &&
      Objects.equals(this.contentText, retrievedChunkResponseDto.contentText) &&
      Objects.equals(this.score, retrievedChunkResponseDto.score) &&
      Objects.equals(
        this.vectorPointId,
        retrievedChunkResponseDto.vectorPointId
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      chunkId,
      documentId,
      documentTitle,
      pageNumber,
      chunkIndex,
      contentText,
      score,
      vectorPointId
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RetrievedChunkResponseDto {\n");
    sb.append("    chunkId: ").append(toIndentedString(chunkId)).append("\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    documentTitle: ")
      .append(toIndentedString(documentTitle))
      .append("\n");
    sb.append("    pageNumber: ")
      .append(toIndentedString(pageNumber))
      .append("\n");
    sb.append("    chunkIndex: ")
      .append(toIndentedString(chunkIndex))
      .append("\n");
    sb.append("    contentText: ")
      .append(toIndentedString(contentText))
      .append("\n");
    sb.append("    score: ").append(toIndentedString(score)).append("\n");
    sb.append("    vectorPointId: ")
      .append(toIndentedString(vectorPointId))
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

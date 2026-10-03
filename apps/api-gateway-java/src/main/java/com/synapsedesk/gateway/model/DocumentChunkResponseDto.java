package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * DocumentChunkResponseDto
 */

public class DocumentChunkResponseDto {

  private String id;

  private String documentId;

  private BigDecimal chunkIndex;

  private String contentText;

  private BigDecimal pageNumber = null;

  private BigDecimal tokenCount;

  private String vectorPointId = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public DocumentChunkResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentChunkResponseDto(
    String id,
    String documentId,
    BigDecimal chunkIndex,
    String contentText,
    BigDecimal pageNumber,
    BigDecimal tokenCount,
    String vectorPointId,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.documentId = documentId;
    this.chunkIndex = chunkIndex;
    this.contentText = contentText;
    this.pageNumber = pageNumber;
    this.tokenCount = tokenCount;
    this.vectorPointId = vectorPointId;
    this.createdAt = createdAt;
  }

  public DocumentChunkResponseDto id(String id) {
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

  public DocumentChunkResponseDto documentId(String documentId) {
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

  public DocumentChunkResponseDto chunkIndex(BigDecimal chunkIndex) {
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

  public DocumentChunkResponseDto contentText(String contentText) {
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

  public DocumentChunkResponseDto pageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
    return this;
  }

  /**
   * Get pageNumber
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

  public DocumentChunkResponseDto tokenCount(BigDecimal tokenCount) {
    this.tokenCount = tokenCount;
    return this;
  }

  /**
   * Get tokenCount
   * @return tokenCount
   */
  @NotNull
  @Valid
  @JsonProperty("tokenCount")
  public BigDecimal getTokenCount() {
    return tokenCount;
  }

  @JsonProperty("tokenCount")
  public void setTokenCount(BigDecimal tokenCount) {
    this.tokenCount = tokenCount;
  }

  public DocumentChunkResponseDto vectorPointId(String vectorPointId) {
    this.vectorPointId = vectorPointId;
    return this;
  }

  /**
   * null until the Qdrant upsert has written it back — i.e. not yet retrievable.
   * @return vectorPointId
   */

  @JsonProperty("vectorPointId")
  public String getVectorPointId() {
    return vectorPointId;
  }

  @JsonProperty("vectorPointId")
  public void setVectorPointId(String vectorPointId) {
    this.vectorPointId = vectorPointId;
  }

  public DocumentChunkResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentChunkResponseDto documentChunkResponseDto =
      (DocumentChunkResponseDto) o;
    return (
      Objects.equals(this.id, documentChunkResponseDto.id) &&
      Objects.equals(this.documentId, documentChunkResponseDto.documentId) &&
      Objects.equals(this.chunkIndex, documentChunkResponseDto.chunkIndex) &&
      Objects.equals(this.contentText, documentChunkResponseDto.contentText) &&
      Objects.equals(this.pageNumber, documentChunkResponseDto.pageNumber) &&
      Objects.equals(this.tokenCount, documentChunkResponseDto.tokenCount) &&
      Objects.equals(
        this.vectorPointId,
        documentChunkResponseDto.vectorPointId
      ) &&
      Objects.equals(this.createdAt, documentChunkResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      documentId,
      chunkIndex,
      contentText,
      pageNumber,
      tokenCount,
      vectorPointId,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentChunkResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    chunkIndex: ")
      .append(toIndentedString(chunkIndex))
      .append("\n");
    sb.append("    contentText: ")
      .append(toIndentedString(contentText))
      .append("\n");
    sb.append("    pageNumber: ")
      .append(toIndentedString(pageNumber))
      .append("\n");
    sb.append("    tokenCount: ")
      .append(toIndentedString(tokenCount))
      .append("\n");
    sb.append("    vectorPointId: ")
      .append(toIndentedString(vectorPointId))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
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

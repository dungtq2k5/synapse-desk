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
 * DocumentUsageResponseDto
 */

public class DocumentUsageResponseDto {

  private String documentId;

  private String title;

  private BigDecimal retrievalCount;

  private BigDecimal citationCount;

  private BigDecimal chunkCount;

  public DocumentUsageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentUsageResponseDto(String documentId, String title, BigDecimal retrievalCount, BigDecimal citationCount, BigDecimal chunkCount) {
    this.documentId = documentId;
    this.title = title;
    this.retrievalCount = retrievalCount;
    this.citationCount = citationCount;
    this.chunkCount = chunkCount;
  }

  public DocumentUsageResponseDto documentId(String documentId) {
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

  public DocumentUsageResponseDto title(String title) {
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

  public DocumentUsageResponseDto retrievalCount(BigDecimal retrievalCount) {
    this.retrievalCount = retrievalCount;
    return this;
  }

  /**
   * Get retrievalCount
   * @return retrievalCount
   */
  @NotNull @Valid 
  @JsonProperty("retrievalCount")
  public BigDecimal getRetrievalCount() {
    return retrievalCount;
  }

  @JsonProperty("retrievalCount")
  public void setRetrievalCount(BigDecimal retrievalCount) {
    this.retrievalCount = retrievalCount;
  }

  public DocumentUsageResponseDto citationCount(BigDecimal citationCount) {
    this.citationCount = citationCount;
    return this;
  }

  /**
   * Get citationCount
   * @return citationCount
   */
  @NotNull @Valid 
  @JsonProperty("citationCount")
  public BigDecimal getCitationCount() {
    return citationCount;
  }

  @JsonProperty("citationCount")
  public void setCitationCount(BigDecimal citationCount) {
    this.citationCount = citationCount;
  }

  public DocumentUsageResponseDto chunkCount(BigDecimal chunkCount) {
    this.chunkCount = chunkCount;
    return this;
  }

  /**
   * Get chunkCount
   * @return chunkCount
   */
  @NotNull @Valid 
  @JsonProperty("chunkCount")
  public BigDecimal getChunkCount() {
    return chunkCount;
  }

  @JsonProperty("chunkCount")
  public void setChunkCount(BigDecimal chunkCount) {
    this.chunkCount = chunkCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentUsageResponseDto documentUsageResponseDto = (DocumentUsageResponseDto) o;
    return Objects.equals(this.documentId, documentUsageResponseDto.documentId) &&
        Objects.equals(this.title, documentUsageResponseDto.title) &&
        Objects.equals(this.retrievalCount, documentUsageResponseDto.retrievalCount) &&
        Objects.equals(this.citationCount, documentUsageResponseDto.citationCount) &&
        Objects.equals(this.chunkCount, documentUsageResponseDto.chunkCount);
  }

  @Override
  public int hashCode() {
    return Objects.hash(documentId, title, retrievalCount, citationCount, chunkCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentUsageResponseDto {\n");
    sb.append("    documentId: ").append(toIndentedString(documentId)).append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    retrievalCount: ").append(toIndentedString(retrievalCount)).append("\n");
    sb.append("    citationCount: ").append(toIndentedString(citationCount)).append("\n");
    sb.append("    chunkCount: ").append(toIndentedString(chunkCount)).append("\n");
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


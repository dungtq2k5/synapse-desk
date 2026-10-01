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
 * KnowledgeArticleResponseDto
 */

public class KnowledgeArticleResponseDto {

  private String id;

  private String title;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  private BigDecimal chunkCount;

  public KnowledgeArticleResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeArticleResponseDto(String id, String title, OffsetDateTime updatedAt, BigDecimal chunkCount) {
    this.id = id;
    this.title = title;
    this.updatedAt = updatedAt;
    this.chunkCount = chunkCount;
  }

  public KnowledgeArticleResponseDto id(String id) {
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

  public KnowledgeArticleResponseDto title(String title) {
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

  public KnowledgeArticleResponseDto updatedAt(OffsetDateTime updatedAt) {
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

  public KnowledgeArticleResponseDto chunkCount(BigDecimal chunkCount) {
    this.chunkCount = chunkCount;
    return this;
  }

  /**
   * The only reading-length signal on this response, `fileSizeBytes` being absent.
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
    KnowledgeArticleResponseDto knowledgeArticleResponseDto = (KnowledgeArticleResponseDto) o;
    return Objects.equals(this.id, knowledgeArticleResponseDto.id) &&
        Objects.equals(this.title, knowledgeArticleResponseDto.title) &&
        Objects.equals(this.updatedAt, knowledgeArticleResponseDto.updatedAt) &&
        Objects.equals(this.chunkCount, knowledgeArticleResponseDto.chunkCount);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, title, updatedAt, chunkCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeArticleResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    updatedAt: ").append(toIndentedString(updatedAt)).append("\n");
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


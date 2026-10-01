package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.KnowledgeArticleBlockResponseDto;
import com.synapsedesk.gateway.generated.model.KnowledgeArticleResponseDto;
import com.synapsedesk.gateway.generated.model.PaginationMetaDataResponseDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * KnowledgeArticleDetailResponseDto
 */

public class KnowledgeArticleDetailResponseDto {

  private KnowledgeArticleResponseDto article;

  private List<@Valid KnowledgeArticleBlockResponseDto> blocks = new ArrayList<>();

  private PaginationMetaDataResponseDto meta;

  private Boolean hasUnindexedPages;

  public KnowledgeArticleDetailResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeArticleDetailResponseDto(KnowledgeArticleResponseDto article, List<@Valid KnowledgeArticleBlockResponseDto> blocks, PaginationMetaDataResponseDto meta, Boolean hasUnindexedPages) {
    this.article = article;
    this.blocks = blocks;
    this.meta = meta;
    this.hasUnindexedPages = hasUnindexedPages;
  }

  public KnowledgeArticleDetailResponseDto article(KnowledgeArticleResponseDto article) {
    this.article = article;
    return this;
  }

  /**
   * Get article
   * @return article
   */
  @NotNull @Valid 
  @JsonProperty("article")
  public KnowledgeArticleResponseDto getArticle() {
    return article;
  }

  @JsonProperty("article")
  public void setArticle(KnowledgeArticleResponseDto article) {
    this.article = article;
  }

  public KnowledgeArticleDetailResponseDto blocks(List<@Valid KnowledgeArticleBlockResponseDto> blocks) {
    this.blocks = blocks;
    return this;
  }

  public KnowledgeArticleDetailResponseDto addBlocksItem(KnowledgeArticleBlockResponseDto blocksItem) {
    if (this.blocks == null) {
      this.blocks = new ArrayList<>();
    }
    this.blocks.add(blocksItem);
    return this;
  }

  /**
   * Get blocks
   * @return blocks
   */
  @NotNull @Valid 
  @JsonProperty("blocks")
  public List<@Valid KnowledgeArticleBlockResponseDto> getBlocks() {
    return blocks;
  }

  @JsonProperty("blocks")
  public void setBlocks(List<@Valid KnowledgeArticleBlockResponseDto> blocks) {
    this.blocks = blocks;
  }

  public KnowledgeArticleDetailResponseDto meta(PaginationMetaDataResponseDto meta) {
    this.meta = meta;
    return this;
  }

  /**
   * Describes the BLOCK range, not a page of articles.  A whole document is unbounded — a 200-page handbook is hundreds of blocks — so the detail view pages through the text rather than returning it whole.
   * @return meta
   */
  @NotNull @Valid 
  @JsonProperty("meta")
  public PaginationMetaDataResponseDto getMeta() {
    return meta;
  }

  @JsonProperty("meta")
  public void setMeta(PaginationMetaDataResponseDto meta) {
    this.meta = meta;
  }

  public KnowledgeArticleDetailResponseDto hasUnindexedPages(Boolean hasUnindexedPages) {
    this.hasUnindexedPages = hasUnindexedPages;
    return this;
  }

  /**
   * True when some of the source could not be read.  The blocks are then less than the document, and nothing in them shows it — `chunkIndex` is contiguous over what survived, so there is no gap to notice. Render it as a notice rather than hiding the article: 197 readable pages beat none, which is the trade indexing already made.
   * @return hasUnindexedPages
   */
  @NotNull 
  @JsonProperty("hasUnindexedPages")
  public Boolean getHasUnindexedPages() {
    return hasUnindexedPages;
  }

  @JsonProperty("hasUnindexedPages")
  public void setHasUnindexedPages(Boolean hasUnindexedPages) {
    this.hasUnindexedPages = hasUnindexedPages;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeArticleDetailResponseDto knowledgeArticleDetailResponseDto = (KnowledgeArticleDetailResponseDto) o;
    return Objects.equals(this.article, knowledgeArticleDetailResponseDto.article) &&
        Objects.equals(this.blocks, knowledgeArticleDetailResponseDto.blocks) &&
        Objects.equals(this.meta, knowledgeArticleDetailResponseDto.meta) &&
        Objects.equals(this.hasUnindexedPages, knowledgeArticleDetailResponseDto.hasUnindexedPages);
  }

  @Override
  public int hashCode() {
    return Objects.hash(article, blocks, meta, hasUnindexedPages);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeArticleDetailResponseDto {\n");
    sb.append("    article: ").append(toIndentedString(article)).append("\n");
    sb.append("    blocks: ").append(toIndentedString(blocks)).append("\n");
    sb.append("    meta: ").append(toIndentedString(meta)).append("\n");
    sb.append("    hasUnindexedPages: ").append(toIndentedString(hasUnindexedPages)).append("\n");
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


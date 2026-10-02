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
import org.springframework.lang.Nullable;

/**
 * KnowledgeSearchDto
 */

public class KnowledgeSearchDto {

  private BigDecimal limit = new BigDecimal("0");

  private Boolean skipRerank = false;

  private String query;

  public KnowledgeSearchDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeSearchDto(String query) {
    this.query = query;
  }

  public KnowledgeSearchDto limit(BigDecimal limit) {
    this.limit = limit;
    return this;
  }

  /**
   * Get limit
   * minimum: 0
   * maximum: 50
   * @return limit
   */
  @Valid
  @DecimalMin(value = "0")
  @DecimalMax(value = "50")
  @JsonProperty("limit")
  public BigDecimal getLimit() {
    return limit;
  }

  @JsonProperty("limit")
  public void setLimit(BigDecimal limit) {
    this.limit = limit;
  }

  public KnowledgeSearchDto skipRerank(Boolean skipRerank) {
    this.skipRerank = skipRerank;
    return this;
  }

  /**
   * Returns what the RETRIEVER found, before the reranker had an opinion.  A diagnostic rather than a performance switch: a Knowledge Manager asking \"why isn't this document coming back\" needs to know whether it lost at retrieval or at rerank, and those are different problems with different fixes.
   * @return skipRerank
   */

  @JsonProperty("skipRerank")
  public Boolean getSkipRerank() {
    return skipRerank;
  }

  @JsonProperty("skipRerank")
  public void setSkipRerank(Boolean skipRerank) {
    this.skipRerank = skipRerank;
  }

  public KnowledgeSearchDto query(String query) {
    this.query = query;
    return this;
  }

  /**
   * Get query
   * @return query
   */
  @NotNull
  @Size(min = 1, max = 1000)
  @JsonProperty("query")
  public String getQuery() {
    return query;
  }

  @JsonProperty("query")
  public void setQuery(String query) {
    this.query = query;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeSearchDto knowledgeSearchDto = (KnowledgeSearchDto) o;
    return (
      Objects.equals(this.limit, knowledgeSearchDto.limit) &&
      Objects.equals(this.skipRerank, knowledgeSearchDto.skipRerank) &&
      Objects.equals(this.query, knowledgeSearchDto.query)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(limit, skipRerank, query);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeSearchDto {\n");
    sb.append("    limit: ").append(toIndentedString(limit)).append("\n");
    sb.append("    skipRerank: ")
      .append(toIndentedString(skipRerank))
      .append("\n");
    sb.append("    query: ").append(toIndentedString(query)).append("\n");
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

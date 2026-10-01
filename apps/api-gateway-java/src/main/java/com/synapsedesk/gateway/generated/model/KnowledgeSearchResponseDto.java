package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.generated.model.RetrievedChunkResponseDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * KnowledgeSearchResponseDto
 */

public class KnowledgeSearchResponseDto {

  private List<@Valid RetrievedChunkResponseDto> chunks = new ArrayList<>();

  /**
   * Why this result set is thinner than usual, or `null` when it is not.  `LEXICAL_ONLY` means the vector search was skipped.
   */
  public enum DegradedEnum {
    LEXICAL_ONLY("LEXICAL_ONLY");

    private final String value;

    DegradedEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static DegradedEnum fromValue(String value) {
      for (DegradedEnum b : DegradedEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private DegradedEnum degraded = null;

  public KnowledgeSearchResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeSearchResponseDto(List<@Valid RetrievedChunkResponseDto> chunks, DegradedEnum degraded) {
    this.chunks = chunks;
    this.degraded = degraded;
  }

  public KnowledgeSearchResponseDto chunks(List<@Valid RetrievedChunkResponseDto> chunks) {
    this.chunks = chunks;
    return this;
  }

  public KnowledgeSearchResponseDto addChunksItem(RetrievedChunkResponseDto chunksItem) {
    if (this.chunks == null) {
      this.chunks = new ArrayList<>();
    }
    this.chunks.add(chunksItem);
    return this;
  }

  /**
   * Get chunks
   * @return chunks
   */
  @NotNull @Valid 
  @JsonProperty("chunks")
  public List<@Valid RetrievedChunkResponseDto> getChunks() {
    return chunks;
  }

  @JsonProperty("chunks")
  public void setChunks(List<@Valid RetrievedChunkResponseDto> chunks) {
    this.chunks = chunks;
  }

  public KnowledgeSearchResponseDto degraded(DegradedEnum degraded) {
    this.degraded = degraded;
    return this;
  }

  /**
   * Why this result set is thinner than usual, or `null` when it is not.  `LEXICAL_ONLY` means the vector search was skipped.
   * @return degraded
   */
  
  @JsonProperty("degraded")
  public DegradedEnum getDegraded() {
    return degraded;
  }

  @JsonProperty("degraded")
  public void setDegraded(DegradedEnum degraded) {
    this.degraded = degraded;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeSearchResponseDto knowledgeSearchResponseDto = (KnowledgeSearchResponseDto) o;
    return Objects.equals(this.chunks, knowledgeSearchResponseDto.chunks) &&
        Objects.equals(this.degraded, knowledgeSearchResponseDto.degraded);
  }

  @Override
  public int hashCode() {
    return Objects.hash(chunks, degraded);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeSearchResponseDto {\n");
    sb.append("    chunks: ").append(toIndentedString(chunks)).append("\n");
    sb.append("    degraded: ").append(toIndentedString(degraded)).append("\n");
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


package com.synapsedesk.gateway.modules.knowledge.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.common.dto.CitationResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * KnowledgeAskResponseDto
 */

public class KnowledgeAskResponseDto {

  private String content;

  /**
   * `null` only if the peer sent a member this build does not know.
   */
  public enum StatusEnum {
    AT_CAP("AT_CAP"),

    DOC_ANSWER("DOC_ANSWER"),

    DOC_MISSING("DOC_MISSING"),

    GREETING("GREETING"),

    REFUSED("REFUSED");

    private final String value;

    StatusEnum(String value) {
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
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private StatusEnum status = null;

  private List<@Valid CitationResponseDto> citations = new ArrayList<>();

  private String generationId;

  public KnowledgeAskResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeAskResponseDto(
    String content,
    StatusEnum status,
    List<@Valid CitationResponseDto> citations,
    String generationId
  ) {
    this.content = content;
    this.status = status;
    this.citations = citations;
    this.generationId = generationId;
  }

  public KnowledgeAskResponseDto content(String content) {
    this.content = content;
    return this;
  }

  /**
   * Get content
   * @return content
   */
  @NotNull
  @JsonProperty("content")
  public String getContent() {
    return content;
  }

  @JsonProperty("content")
  public void setContent(String content) {
    this.content = content;
  }

  public KnowledgeAskResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `null` only if the peer sent a member this build does not know.
   * @return status
   */

  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public KnowledgeAskResponseDto citations(
    List<@Valid CitationResponseDto> citations
  ) {
    this.citations = citations;
    return this;
  }

  public KnowledgeAskResponseDto addCitationsItem(
    CitationResponseDto citationsItem
  ) {
    if (this.citations == null) {
      this.citations = new ArrayList<>();
    }
    this.citations.add(citationsItem);
    return this;
  }

  /**
   * Get citations
   * @return citations
   */
  @NotNull
  @Valid
  @JsonProperty("citations")
  public List<@Valid CitationResponseDto> getCitations() {
    return citations;
  }

  @JsonProperty("citations")
  public void setCitations(List<@Valid CitationResponseDto> citations) {
    this.citations = citations;
  }

  public KnowledgeAskResponseDto generationId(String generationId) {
    this.generationId = generationId;
    return this;
  }

  /**
   * The `ai_generations` row this answer was billed to.  Returned so the answer is identifiable after the fact. Nothing can rate it yet — `ai_response_feedbacks` is keyed on `ticket_message_id` and an ask produces no message.
   * @return generationId
   */
  @NotNull
  @JsonProperty("generationId")
  public String getGenerationId() {
    return generationId;
  }

  @JsonProperty("generationId")
  public void setGenerationId(String generationId) {
    this.generationId = generationId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeAskResponseDto knowledgeAskResponseDto =
      (KnowledgeAskResponseDto) o;
    return (
      Objects.equals(this.content, knowledgeAskResponseDto.content) &&
      Objects.equals(this.status, knowledgeAskResponseDto.status) &&
      Objects.equals(this.citations, knowledgeAskResponseDto.citations) &&
      Objects.equals(this.generationId, knowledgeAskResponseDto.generationId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(content, status, citations, generationId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeAskResponseDto {\n");
    sb.append("    content: ").append(toIndentedString(content)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    citations: ")
      .append(toIndentedString(citations))
      .append("\n");
    sb.append("    generationId: ")
      .append(toIndentedString(generationId))
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

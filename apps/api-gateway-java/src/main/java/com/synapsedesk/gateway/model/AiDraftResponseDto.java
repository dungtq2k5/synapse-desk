package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.DraftCitationResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AiDraftResponseDto
 */

public class AiDraftResponseDto {

  private String content;

  private String modelName;

  private BigDecimal promptTokens;

  private BigDecimal completionTokens;

  private String generationId;

  private List<@Valid DraftCitationResponseDto> citations = new ArrayList<>();

  public AiDraftResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiDraftResponseDto(
    String content,
    String modelName,
    BigDecimal promptTokens,
    BigDecimal completionTokens,
    String generationId,
    List<@Valid DraftCitationResponseDto> citations
  ) {
    this.content = content;
    this.modelName = modelName;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.generationId = generationId;
    this.citations = citations;
  }

  public AiDraftResponseDto content(String content) {
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

  public AiDraftResponseDto modelName(String modelName) {
    this.modelName = modelName;
    return this;
  }

  /**
   * Get modelName
   * @return modelName
   */
  @NotNull
  @JsonProperty("modelName")
  public String getModelName() {
    return modelName;
  }

  @JsonProperty("modelName")
  public void setModelName(String modelName) {
    this.modelName = modelName;
  }

  public AiDraftResponseDto promptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
    return this;
  }

  /**
   * Get promptTokens
   * @return promptTokens
   */
  @NotNull
  @Valid
  @JsonProperty("promptTokens")
  public BigDecimal getPromptTokens() {
    return promptTokens;
  }

  @JsonProperty("promptTokens")
  public void setPromptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
  }

  public AiDraftResponseDto completionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
    return this;
  }

  /**
   * Get completionTokens
   * @return completionTokens
   */
  @NotNull
  @Valid
  @JsonProperty("completionTokens")
  public BigDecimal getCompletionTokens() {
    return completionTokens;
  }

  @JsonProperty("completionTokens")
  public void setCompletionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
  }

  public AiDraftResponseDto generationId(String generationId) {
    this.generationId = generationId;
    return this;
  }

  /**
   * The `ai_generations` row this draft came from.  **Hand it back as `generatedFromId` when posting the reply.** That is what lets ticket-service record the draft as ACCEPTED or EDITED; omit it and the hourly sweep records it as DISCARDED instead.
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

  public AiDraftResponseDto citations(
    List<@Valid DraftCitationResponseDto> citations
  ) {
    this.citations = citations;
    return this;
  }

  public AiDraftResponseDto addCitationsItem(
    DraftCitationResponseDto citationsItem
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
  public List<@Valid DraftCitationResponseDto> getCitations() {
    return citations;
  }

  @JsonProperty("citations")
  public void setCitations(List<@Valid DraftCitationResponseDto> citations) {
    this.citations = citations;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiDraftResponseDto aiDraftResponseDto = (AiDraftResponseDto) o;
    return (
      Objects.equals(this.content, aiDraftResponseDto.content) &&
      Objects.equals(this.modelName, aiDraftResponseDto.modelName) &&
      Objects.equals(this.promptTokens, aiDraftResponseDto.promptTokens) &&
      Objects.equals(
        this.completionTokens,
        aiDraftResponseDto.completionTokens
      ) &&
      Objects.equals(this.generationId, aiDraftResponseDto.generationId) &&
      Objects.equals(this.citations, aiDraftResponseDto.citations)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      content,
      modelName,
      promptTokens,
      completionTokens,
      generationId,
      citations
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiDraftResponseDto {\n");
    sb.append("    content: ").append(toIndentedString(content)).append("\n");
    sb.append("    modelName: ")
      .append(toIndentedString(modelName))
      .append("\n");
    sb.append("    promptTokens: ")
      .append(toIndentedString(promptTokens))
      .append("\n");
    sb.append("    completionTokens: ")
      .append(toIndentedString(completionTokens))
      .append("\n");
    sb.append("    generationId: ")
      .append(toIndentedString(generationId))
      .append("\n");
    sb.append("    citations: ")
      .append(toIndentedString(citations))
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

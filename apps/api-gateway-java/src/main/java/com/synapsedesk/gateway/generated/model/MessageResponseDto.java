package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.generated.model.AttachmentResponseDto;
import com.synapsedesk.gateway.generated.model.CitationResponseDto;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * MessageResponseDto
 */

public class MessageResponseDto {

  private String id;

  private String ticketId;

  private String senderId = null;

  private String content;

  private Boolean isAiGenerated;

  private Boolean isInternalNote;

  private String modelName = null;

  private BigDecimal promptTokens = null;

  private BigDecimal completionTokens = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime editedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime redactedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  private List<@Valid AttachmentResponseDto> attachments = new ArrayList<>();

  private Boolean excludedFromAiContext;

  /**
   * What the generation concluded.  `null` for a human message, and also for a status this build cannot name.
   */
  public enum AnswerStatusEnum {
    AT_CAP("AT_CAP"),
    
    DOC_ANSWER("DOC_ANSWER"),
    
    DOC_MISSING("DOC_MISSING"),
    
    GREETING("GREETING"),
    
    REFUSED("REFUSED");

    private final String value;

    AnswerStatusEnum(String value) {
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
    public static AnswerStatusEnum fromValue(String value) {
      for (AnswerStatusEnum b : AnswerStatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private AnswerStatusEnum answerStatus = null;

  private List<@Valid CitationResponseDto> citations;

  public MessageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public MessageResponseDto(String id, String ticketId, String senderId, String content, Boolean isAiGenerated, Boolean isInternalNote, String modelName, BigDecimal promptTokens, BigDecimal completionTokens, OffsetDateTime editedAt, OffsetDateTime redactedAt, OffsetDateTime createdAt, List<@Valid AttachmentResponseDto> attachments, Boolean excludedFromAiContext, AnswerStatusEnum answerStatus, List<@Valid CitationResponseDto> citations) {
    this.id = id;
    this.ticketId = ticketId;
    this.senderId = senderId;
    this.content = content;
    this.isAiGenerated = isAiGenerated;
    this.isInternalNote = isInternalNote;
    this.modelName = modelName;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.editedAt = editedAt;
    this.redactedAt = redactedAt;
    this.createdAt = createdAt;
    this.attachments = attachments;
    this.excludedFromAiContext = excludedFromAiContext;
    this.answerStatus = answerStatus;
    this.citations = citations;
  }

  public MessageResponseDto id(String id) {
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

  public MessageResponseDto ticketId(String ticketId) {
    this.ticketId = ticketId;
    return this;
  }

  /**
   * Get ticketId
   * @return ticketId
   */
  @NotNull 
  @JsonProperty("ticketId")
  public String getTicketId() {
    return ticketId;
  }

  @JsonProperty("ticketId")
  public void setTicketId(String ticketId) {
    this.ticketId = ticketId;
  }

  public MessageResponseDto senderId(String senderId) {
    this.senderId = senderId;
    return this;
  }

  /**
   * null for an AI-generated message — no user wrote it.
   * @return senderId
   */
  
  @JsonProperty("senderId")
  public String getSenderId() {
    return senderId;
  }

  @JsonProperty("senderId")
  public void setSenderId(String senderId) {
    this.senderId = senderId;
  }

  public MessageResponseDto content(String content) {
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

  public MessageResponseDto isAiGenerated(Boolean isAiGenerated) {
    this.isAiGenerated = isAiGenerated;
    return this;
  }

  /**
   * Get isAiGenerated
   * @return isAiGenerated
   */
  @NotNull 
  @JsonProperty("isAiGenerated")
  public Boolean getIsAiGenerated() {
    return isAiGenerated;
  }

  @JsonProperty("isAiGenerated")
  public void setIsAiGenerated(Boolean isAiGenerated) {
    this.isAiGenerated = isAiGenerated;
  }

  public MessageResponseDto isInternalNote(Boolean isInternalNote) {
    this.isInternalNote = isInternalNote;
    return this;
  }

  /**
   * Get isInternalNote
   * @return isInternalNote
   */
  @NotNull 
  @JsonProperty("isInternalNote")
  public Boolean getIsInternalNote() {
    return isInternalNote;
  }

  @JsonProperty("isInternalNote")
  public void setIsInternalNote(Boolean isInternalNote) {
    this.isInternalNote = isInternalNote;
  }

  public MessageResponseDto modelName(String modelName) {
    this.modelName = modelName;
    return this;
  }

  /**
   * Get modelName
   * @return modelName
   */
  
  @JsonProperty("modelName")
  public String getModelName() {
    return modelName;
  }

  @JsonProperty("modelName")
  public void setModelName(String modelName) {
    this.modelName = modelName;
  }

  public MessageResponseDto promptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
    return this;
  }

  /**
   * Get promptTokens
   * @return promptTokens
   */
  @Valid 
  @JsonProperty("promptTokens")
  public BigDecimal getPromptTokens() {
    return promptTokens;
  }

  @JsonProperty("promptTokens")
  public void setPromptTokens(BigDecimal promptTokens) {
    this.promptTokens = promptTokens;
  }

  public MessageResponseDto completionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
    return this;
  }

  /**
   * Get completionTokens
   * @return completionTokens
   */
  @Valid 
  @JsonProperty("completionTokens")
  public BigDecimal getCompletionTokens() {
    return completionTokens;
  }

  @JsonProperty("completionTokens")
  public void setCompletionTokens(BigDecimal completionTokens) {
    this.completionTokens = completionTokens;
  }

  public MessageResponseDto editedAt(OffsetDateTime editedAt) {
    this.editedAt = editedAt;
    return this;
  }

  /**
   * Get editedAt
   * @return editedAt
   */
  @Valid 
  @JsonProperty("editedAt")
  public OffsetDateTime getEditedAt() {
    return editedAt;
  }

  @JsonProperty("editedAt")
  public void setEditedAt(OffsetDateTime editedAt) {
    this.editedAt = editedAt;
  }

  public MessageResponseDto redactedAt(OffsetDateTime redactedAt) {
    this.redactedAt = redactedAt;
    return this;
  }

  /**
   * Get redactedAt
   * @return redactedAt
   */
  @Valid 
  @JsonProperty("redactedAt")
  public OffsetDateTime getRedactedAt() {
    return redactedAt;
  }

  @JsonProperty("redactedAt")
  public void setRedactedAt(OffsetDateTime redactedAt) {
    this.redactedAt = redactedAt;
  }

  public MessageResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull @Valid 
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public MessageResponseDto attachments(List<@Valid AttachmentResponseDto> attachments) {
    this.attachments = attachments;
    return this;
  }

  public MessageResponseDto addAttachmentsItem(AttachmentResponseDto attachmentsItem) {
    if (this.attachments == null) {
      this.attachments = new ArrayList<>();
    }
    this.attachments.add(attachmentsItem);
    return this;
  }

  /**
   * Get attachments
   * @return attachments
   */
  @NotNull @Valid 
  @JsonProperty("attachments")
  public List<@Valid AttachmentResponseDto> getAttachments() {
    return attachments;
  }

  @JsonProperty("attachments")
  public void setAttachments(List<@Valid AttachmentResponseDto> attachments) {
    this.attachments = attachments;
  }

  public MessageResponseDto excludedFromAiContext(Boolean excludedFromAiContext) {
    this.excludedFromAiContext = excludedFromAiContext;
    return this;
  }

  /**
   * Kept OUT of AI prompts.  Exposed rather than stripped: the transcript builder in `AiStreamService` filters on it AFTER fetching, because the same route serves the UI, where a refused message stays visible.
   * @return excludedFromAiContext
   */
  @NotNull 
  @JsonProperty("excludedFromAiContext")
  public Boolean getExcludedFromAiContext() {
    return excludedFromAiContext;
  }

  @JsonProperty("excludedFromAiContext")
  public void setExcludedFromAiContext(Boolean excludedFromAiContext) {
    this.excludedFromAiContext = excludedFromAiContext;
  }

  public MessageResponseDto answerStatus(AnswerStatusEnum answerStatus) {
    this.answerStatus = answerStatus;
    return this;
  }

  /**
   * What the generation concluded.  `null` for a human message, and also for a status this build cannot name.
   * @return answerStatus
   */
  
  @JsonProperty("answerStatus")
  public AnswerStatusEnum getAnswerStatus() {
    return answerStatus;
  }

  @JsonProperty("answerStatus")
  public void setAnswerStatus(AnswerStatusEnum answerStatus) {
    this.answerStatus = answerStatus;
  }

  public MessageResponseDto citations(List<@Valid CitationResponseDto> citations) {
    this.citations = citations;
    return this;
  }

  public MessageResponseDto addCitationsItem(CitationResponseDto citationsItem) {
    if (this.citations == null) {
      this.citations = new ArrayList<>();
    }
    this.citations.add(citationsItem);
    return this;
  }

  /**
   * What an AI answer cited.  `null` for a human message and for an AI message written before citations were stored; `[]` for an answer that cited nothing.
   * @return citations
   */
  @Valid 
  @JsonProperty("citations")
  public List<@Valid CitationResponseDto> getCitations() {
    return citations;
  }

  @JsonProperty("citations")
  public void setCitations(List<@Valid CitationResponseDto> citations) {
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
    MessageResponseDto messageResponseDto = (MessageResponseDto) o;
    return Objects.equals(this.id, messageResponseDto.id) &&
        Objects.equals(this.ticketId, messageResponseDto.ticketId) &&
        Objects.equals(this.senderId, messageResponseDto.senderId) &&
        Objects.equals(this.content, messageResponseDto.content) &&
        Objects.equals(this.isAiGenerated, messageResponseDto.isAiGenerated) &&
        Objects.equals(this.isInternalNote, messageResponseDto.isInternalNote) &&
        Objects.equals(this.modelName, messageResponseDto.modelName) &&
        Objects.equals(this.promptTokens, messageResponseDto.promptTokens) &&
        Objects.equals(this.completionTokens, messageResponseDto.completionTokens) &&
        Objects.equals(this.editedAt, messageResponseDto.editedAt) &&
        Objects.equals(this.redactedAt, messageResponseDto.redactedAt) &&
        Objects.equals(this.createdAt, messageResponseDto.createdAt) &&
        Objects.equals(this.attachments, messageResponseDto.attachments) &&
        Objects.equals(this.excludedFromAiContext, messageResponseDto.excludedFromAiContext) &&
        Objects.equals(this.answerStatus, messageResponseDto.answerStatus) &&
        Objects.equals(this.citations, messageResponseDto.citations);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, ticketId, senderId, content, isAiGenerated, isInternalNote, modelName, promptTokens, completionTokens, editedAt, redactedAt, createdAt, attachments, excludedFromAiContext, answerStatus, citations);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MessageResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    senderId: ").append(toIndentedString(senderId)).append("\n");
    sb.append("    content: ").append(toIndentedString(content)).append("\n");
    sb.append("    isAiGenerated: ").append(toIndentedString(isAiGenerated)).append("\n");
    sb.append("    isInternalNote: ").append(toIndentedString(isInternalNote)).append("\n");
    sb.append("    modelName: ").append(toIndentedString(modelName)).append("\n");
    sb.append("    promptTokens: ").append(toIndentedString(promptTokens)).append("\n");
    sb.append("    completionTokens: ").append(toIndentedString(completionTokens)).append("\n");
    sb.append("    editedAt: ").append(toIndentedString(editedAt)).append("\n");
    sb.append("    redactedAt: ").append(toIndentedString(redactedAt)).append("\n");
    sb.append("    createdAt: ").append(toIndentedString(createdAt)).append("\n");
    sb.append("    attachments: ").append(toIndentedString(attachments)).append("\n");
    sb.append("    excludedFromAiContext: ").append(toIndentedString(excludedFromAiContext)).append("\n");
    sb.append("    answerStatus: ").append(toIndentedString(answerStatus)).append("\n");
    sb.append("    citations: ").append(toIndentedString(citations)).append("\n");
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


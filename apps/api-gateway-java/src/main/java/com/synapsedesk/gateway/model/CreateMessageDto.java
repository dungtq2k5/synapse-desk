package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.NewAttachmentDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.lang.Nullable;

/**
 * CreateMessageDto
 */

public class CreateMessageDto {

  private String content;

  private Boolean isInternalNote = false;

  private Boolean invokeAi = false;

  private List<@Valid NewAttachmentDto> attachments = new ArrayList<>();

  private @Nullable UUID generatedFromId;

  public CreateMessageDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateMessageDto(String content) {
    this.content = content;
  }

  public CreateMessageDto content(String content) {
    this.content = content;
    return this;
  }

  /**
   * Markdown is accepted and preserved unmodified — this field is never sanitized, escaped or transformed beyond trimming. Renderers MUST disable raw HTML: markdown permits inline HTML, none is stripped here, and a renderer that passes it through turns this field into stored XSS.
   * @return content
   */
  @NotNull
  @Size(min = 1, max = 20000)
  @JsonProperty("content")
  public String getContent() {
    return content;
  }

  @JsonProperty("content")
  public void setContent(String content) {
    this.content = content;
  }

  public CreateMessageDto isInternalNote(Boolean isInternalNote) {
    this.isInternalNote = isInternalNote;
    return this;
  }

  /**
   * Agent-only, enforced in ticket-service rather than by a route permission: the route itself must stay open to end users, who post ordinary replies through it.
   * @return isInternalNote
   */

  @JsonProperty("isInternalNote")
  public Boolean getIsInternalNote() {
    return isInternalNote;
  }

  @JsonProperty("isInternalNote")
  public void setIsInternalNote(Boolean isInternalNote) {
    this.isInternalNote = isInternalNote;
  }

  public CreateMessageDto invokeAi(Boolean invokeAi) {
    this.invokeAi = invokeAi;
    return this;
  }

  /**
   * Ask for an AI draft after this message lands.  Two writes, never one: the draft can fail without losing what the human typed. Today it always fails — `rag-service` does not exist — and the caller's own message still commits, which is exactly the behaviour that has to survive Domain C shipping.
   * @return invokeAi
   */

  @JsonProperty("invokeAi")
  public Boolean getInvokeAi() {
    return invokeAi;
  }

  @JsonProperty("invokeAi")
  public void setInvokeAi(Boolean invokeAi) {
    this.invokeAi = invokeAi;
  }

  public CreateMessageDto attachments(
    List<@Valid NewAttachmentDto> attachments
  ) {
    this.attachments = attachments;
    return this;
  }

  public CreateMessageDto addAttachmentsItem(NewAttachmentDto attachmentsItem) {
    if (this.attachments == null) {
      this.attachments = new ArrayList<>();
    }
    this.attachments.add(attachmentsItem);
    return this;
  }

  /**
   * Objects already uploaded, bound to this message as it is created   **This is the ordering that makes a first-turn attachment readable.** Presign then confirm-against-a-message meant the row could only exist after the message did, while `invokeAi` runs during the create — so the very screenshot the question was about arrived a moment too late to be seen.  A path that fails its confirm comes back in `skippedAttachments` and the message is still created, and that is why that is the only safe outcome.
   * @return attachments
   */
  @Valid
  @JsonProperty("attachments")
  public List<@Valid NewAttachmentDto> getAttachments() {
    return attachments;
  }

  @JsonProperty("attachments")
  public void setAttachments(List<@Valid NewAttachmentDto> attachments) {
    this.attachments = attachments;
  }

  public CreateMessageDto generatedFromId(@Nullable UUID generatedFromId) {
    this.generatedFromId = generatedFromId;
    return this;
  }

  /**
   * The `ai_generations` row this reply came from — `AiDraftResponseDto`'s `generationId`, handed back.  Send it when posting an AI-drafted reply so the draft is recorded ACCEPTED or EDITED rather than DISCARDED. Absent for an ordinary reply.
   * @return generatedFromId
   */
  @Valid
  @JsonProperty("generatedFromId")
  public @Nullable UUID getGeneratedFromId() {
    return generatedFromId;
  }

  @JsonProperty("generatedFromId")
  public void setGeneratedFromId(@Nullable UUID generatedFromId) {
    this.generatedFromId = generatedFromId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateMessageDto createMessageDto = (CreateMessageDto) o;
    return (
      Objects.equals(this.content, createMessageDto.content) &&
      Objects.equals(this.isInternalNote, createMessageDto.isInternalNote) &&
      Objects.equals(this.invokeAi, createMessageDto.invokeAi) &&
      Objects.equals(this.attachments, createMessageDto.attachments) &&
      Objects.equals(this.generatedFromId, createMessageDto.generatedFromId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      content,
      isInternalNote,
      invokeAi,
      attachments,
      generatedFromId
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateMessageDto {\n");
    sb.append("    content: ").append(toIndentedString(content)).append("\n");
    sb.append("    isInternalNote: ")
      .append(toIndentedString(isInternalNote))
      .append("\n");
    sb.append("    invokeAi: ").append(toIndentedString(invokeAi)).append("\n");
    sb.append("    attachments: ")
      .append(toIndentedString(attachments))
      .append("\n");
    sb.append("    generatedFromId: ")
      .append(toIndentedString(generatedFromId))
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

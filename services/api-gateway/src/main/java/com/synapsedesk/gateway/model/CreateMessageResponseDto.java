package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.MessageResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreateMessageResponseDto
 */

public class CreateMessageResponseDto {

  private MessageResponseDto message;

  private List<String> skippedAttachments = new ArrayList<>();

  public CreateMessageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateMessageResponseDto(
    MessageResponseDto message,
    List<String> skippedAttachments
  ) {
    this.message = message;
    this.skippedAttachments = skippedAttachments;
  }

  public CreateMessageResponseDto message(MessageResponseDto message) {
    this.message = message;
    return this;
  }

  /**
   * Get message
   * @return message
   */
  @NotNull
  @Valid
  @JsonProperty("message")
  public MessageResponseDto getMessage() {
    return message;
  }

  @JsonProperty("message")
  public void setMessage(MessageResponseDto message) {
    this.message = message;
  }

  public CreateMessageResponseDto skippedAttachments(
    List<String> skippedAttachments
  ) {
    this.skippedAttachments = skippedAttachments;
    return this;
  }

  public CreateMessageResponseDto addSkippedAttachmentsItem(
    String skippedAttachmentsItem
  ) {
    if (this.skippedAttachments == null) {
      this.skippedAttachments = new ArrayList<>();
    }
    this.skippedAttachments.add(skippedAttachmentsItem);
    return this;
  }

  /**
   * File NAMES, never object paths and never contents — the same rule the AI's own skipped list follows, and for the same reason: a user reads this.
   * @return skippedAttachments
   */
  @NotNull
  @JsonProperty("skippedAttachments")
  public List<String> getSkippedAttachments() {
    return skippedAttachments;
  }

  @JsonProperty("skippedAttachments")
  public void setSkippedAttachments(List<String> skippedAttachments) {
    this.skippedAttachments = skippedAttachments;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateMessageResponseDto createMessageResponseDto =
      (CreateMessageResponseDto) o;
    return (
      Objects.equals(this.message, createMessageResponseDto.message) &&
      Objects.equals(
        this.skippedAttachments,
        createMessageResponseDto.skippedAttachments
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(message, skippedAttachments);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateMessageResponseDto {\n");
    sb.append("    message: ").append(toIndentedString(message)).append("\n");
    sb.append("    skippedAttachments: ")
      .append(toIndentedString(skippedAttachments))
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

package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * What {@code POST /tickets} and {@code POST /chat/conversations} answer: the
 * ticket, and the opening's files that couldn't be attached.
 *
 * <p>The ticket's own fields stay at the top level, so a client reading the
 * created ticket reads it as before.
 */
public class CreateTicketResponseDto extends TicketResponseDto {

  private List<String> skippedAttachments = new ArrayList<>();

  public CreateTicketResponseDto skippedAttachments(
    List<String> skippedAttachments
  ) {
    this.skippedAttachments = skippedAttachments;
    return this;
  }

  /**
   * File NAMES, never object paths: a path that failed its confirm (expired,
   * not the caller's, not an attachment). The ticket is created regardless.
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
    CreateTicketResponseDto other = (CreateTicketResponseDto) o;
    return (
      super.equals(o) &&
      Objects.equals(this.skippedAttachments, other.skippedAttachments)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(super.hashCode(), skippedAttachments);
  }
}

package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UpdateMessageDto
 */

public class UpdateMessageDto {

  private String content;

  public UpdateMessageDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UpdateMessageDto(String content) {
    this.content = content;
  }

  public UpdateMessageDto content(String content) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateMessageDto updateMessageDto = (UpdateMessageDto) o;
    return Objects.equals(this.content, updateMessageDto.content);
  }

  @Override
  public int hashCode() {
    return Objects.hash(content);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateMessageDto {\n");
    sb.append("    content: ").append(toIndentedString(content)).append("\n");
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

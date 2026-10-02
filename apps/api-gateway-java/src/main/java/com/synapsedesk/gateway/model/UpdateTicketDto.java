package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * UpdateTicketDto
 */

public class UpdateTicketDto {

  private @Nullable String description;

  private @Nullable String title;

  /**
   * Gets or Sets priority
   */
  public enum PriorityEnum {
    HIGH("HIGH"),

    LOW("LOW"),

    MEDIUM("MEDIUM"),

    URGENT("URGENT");

    private final String value;

    PriorityEnum(String value) {
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
    public static PriorityEnum fromValue(String value) {
      for (PriorityEnum b : PriorityEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable PriorityEnum priority;

  public UpdateTicketDto description(@Nullable String description) {
    this.description = description;
    return this;
  }

  /**
   * Markdown is accepted and preserved unmodified — this field is never sanitized, escaped or transformed beyond trimming. Renderers MUST disable raw HTML: markdown permits inline HTML, none is stripped here, and a renderer that passes it through turns this field into stored XSS.
   * @return description
   */
  @Size(min = 1, max = 20000)
  @JsonProperty("description")
  public @Nullable String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(@Nullable String description) {
    this.description = description;
  }

  public UpdateTicketDto title(@Nullable String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @Size(min = 3, max = 255)
  @JsonProperty("title")
  public @Nullable String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(@Nullable String title) {
    this.title = title;
  }

  public UpdateTicketDto priority(@Nullable PriorityEnum priority) {
    this.priority = priority;
    return this;
  }

  /**
   * Get priority
   * @return priority
   */

  @JsonProperty("priority")
  public @Nullable PriorityEnum getPriority() {
    return priority;
  }

  @JsonProperty("priority")
  public void setPriority(@Nullable PriorityEnum priority) {
    this.priority = priority;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateTicketDto updateTicketDto = (UpdateTicketDto) o;
    return (
      Objects.equals(this.description, updateTicketDto.description) &&
      Objects.equals(this.title, updateTicketDto.title) &&
      Objects.equals(this.priority, updateTicketDto.priority)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(description, title, priority);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateTicketDto {\n");
    sb.append("    description: ")
      .append(toIndentedString(description))
      .append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    priority: ").append(toIndentedString(priority)).append("\n");
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

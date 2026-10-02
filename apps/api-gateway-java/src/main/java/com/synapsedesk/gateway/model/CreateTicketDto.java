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
import java.util.UUID;
import org.springframework.lang.Nullable;

/**
 * CreateTicketDto
 */

public class CreateTicketDto {

  private String description;

  private String title;

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

  /**
   * Gets or Sets source
   */
  public enum SourceEnum {
    API("API"),

    CHAT("CHAT"),

    EMAIL("EMAIL"),

    WEB("WEB");

    private final String value;

    SourceEnum(String value) {
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
    public static SourceEnum fromValue(String value) {
      for (SourceEnum b : SourceEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable SourceEnum source;

  private @Nullable UUID authorId;

  public CreateTicketDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateTicketDto(String description, String title) {
    this.description = description;
    this.title = title;
  }

  public CreateTicketDto description(String description) {
    this.description = description;
    return this;
  }

  /**
   * Markdown is accepted and preserved unmodified — this field is never sanitized, escaped or transformed beyond trimming. Renderers MUST disable raw HTML: markdown permits inline HTML, none is stripped here, and a renderer that passes it through turns this field into stored XSS.
   * @return description
   */
  @NotNull
  @Size(min = 1, max = 20000)
  @JsonProperty("description")
  public String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(String description) {
    this.description = description;
  }

  public CreateTicketDto title(String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @NotNull
  @Size(min = 3, max = 255)
  @JsonProperty("title")
  public String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(String title) {
    this.title = title;
  }

  public CreateTicketDto priority(@Nullable PriorityEnum priority) {
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

  public CreateTicketDto source(@Nullable SourceEnum source) {
    this.source = source;
    return this;
  }

  /**
   * Get source
   * @return source
   */

  @JsonProperty("source")
  public @Nullable SourceEnum getSource() {
    return source;
  }

  @JsonProperty("source")
  public void setSource(@Nullable SourceEnum source) {
    this.source = source;
  }

  public CreateTicketDto authorId(@Nullable UUID authorId) {
    this.authorId = authorId;
    return this;
  }

  /**
   * Raising a ticket on behalf of an end user.  Absent means \"the caller\", which is the ordinary case and needs no validation because the id comes from a verified token. When present it is checked against auth-service before the insert — there is no foreign key that could do it, since `users` lives in another database.
   * @return authorId
   */
  @Valid
  @JsonProperty("authorId")
  public @Nullable UUID getAuthorId() {
    return authorId;
  }

  @JsonProperty("authorId")
  public void setAuthorId(@Nullable UUID authorId) {
    this.authorId = authorId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateTicketDto createTicketDto = (CreateTicketDto) o;
    return (
      Objects.equals(this.description, createTicketDto.description) &&
      Objects.equals(this.title, createTicketDto.title) &&
      Objects.equals(this.priority, createTicketDto.priority) &&
      Objects.equals(this.source, createTicketDto.source) &&
      Objects.equals(this.authorId, createTicketDto.authorId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(description, title, priority, source, authorId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateTicketDto {\n");
    sb.append("    description: ")
      .append(toIndentedString(description))
      .append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    priority: ").append(toIndentedString(priority)).append("\n");
    sb.append("    source: ").append(toIndentedString(source)).append("\n");
    sb.append("    authorId: ").append(toIndentedString(authorId)).append("\n");
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

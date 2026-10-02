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
 * PreferenceResponseDto
 */

public class PreferenceResponseDto {

  /**
   * The event this preference is for, or `'*'` for the catch-all row.
   */
  public enum TypeEnum {
    STAR("*"),

    BILLING_PAYMENT_FAILED("billing.payment_failed"),

    BILLING_PLAN_CHANGED("billing.plan_changed"),

    LIMIT_THRESHOLD("limit.threshold"),

    QUOTA_THRESHOLD("quota.threshold"),

    TICKET_ASSIGNED("ticket.assigned"),

    TICKET_ESCALATED("ticket.escalated"),

    TICKET_MESSAGE_CREATED("ticket.message_created"),

    TICKET_REASSIGNED("ticket.reassigned"),

    TICKET_STATUS_CHANGED("ticket.status_changed"),

    WEBHOOK_ENDPOINT_DISABLED("webhook.endpoint_disabled");

    private final String value;

    TypeEnum(String value) {
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
    public static TypeEnum fromValue(String value) {
      for (TypeEnum b : TypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private TypeEnum type = null;

  /**
   * The transport this preference governs.
   */
  public enum ChannelEnum {
    EMAIL("EMAIL"),

    IN_APP("IN_APP"),

    PUSH("PUSH"),

    SMS("SMS"),

    WEBHOOK("WEBHOOK");

    private final String value;

    ChannelEnum(String value) {
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
    public static ChannelEnum fromValue(String value) {
      for (ChannelEnum b : ChannelEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private ChannelEnum channel = null;

  private Boolean isEnabled;

  /**
   * Whether matching notifications batch into a digest.
   */
  public enum DigestEnum {
    DAILY("DAILY"),

    HOURLY("HOURLY"),

    IMMEDIATE("IMMEDIATE"),

    OFF("OFF");

    private final String value;

    DigestEnum(String value) {
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
    public static DigestEnum fromValue(String value) {
      for (DigestEnum b : DigestEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private DigestEnum digest = null;

  /**
   * Where the value came from.  Lets the UI show \"inherited\" rather than presenting a default as a choice.
   */
  public enum SourceEnum {
    DEFAULT("DEFAULT"),

    EXPLICIT("EXPLICIT"),

    WILDCARD("WILDCARD");

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
      return null;
    }
  }

  private SourceEnum source = null;

  public PreferenceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PreferenceResponseDto(
    TypeEnum type,
    ChannelEnum channel,
    Boolean isEnabled,
    DigestEnum digest,
    SourceEnum source
  ) {
    this.type = type;
    this.channel = channel;
    this.isEnabled = isEnabled;
    this.digest = digest;
    this.source = source;
  }

  public PreferenceResponseDto type(TypeEnum type) {
    this.type = type;
    return this;
  }

  /**
   * The event this preference is for, or `'*'` for the catch-all row.
   * @return type
   */

  @JsonProperty("type")
  public TypeEnum getType() {
    return type;
  }

  @JsonProperty("type")
  public void setType(TypeEnum type) {
    this.type = type;
  }

  public PreferenceResponseDto channel(ChannelEnum channel) {
    this.channel = channel;
    return this;
  }

  /**
   * The transport this preference governs.
   * @return channel
   */

  @JsonProperty("channel")
  public ChannelEnum getChannel() {
    return channel;
  }

  @JsonProperty("channel")
  public void setChannel(ChannelEnum channel) {
    this.channel = channel;
  }

  public PreferenceResponseDto isEnabled(Boolean isEnabled) {
    this.isEnabled = isEnabled;
    return this;
  }

  /**
   * Get isEnabled
   * @return isEnabled
   */
  @NotNull
  @JsonProperty("isEnabled")
  public Boolean getIsEnabled() {
    return isEnabled;
  }

  @JsonProperty("isEnabled")
  public void setIsEnabled(Boolean isEnabled) {
    this.isEnabled = isEnabled;
  }

  public PreferenceResponseDto digest(DigestEnum digest) {
    this.digest = digest;
    return this;
  }

  /**
   * Whether matching notifications batch into a digest.
   * @return digest
   */

  @JsonProperty("digest")
  public DigestEnum getDigest() {
    return digest;
  }

  @JsonProperty("digest")
  public void setDigest(DigestEnum digest) {
    this.digest = digest;
  }

  public PreferenceResponseDto source(SourceEnum source) {
    this.source = source;
    return this;
  }

  /**
   * Where the value came from.  Lets the UI show \"inherited\" rather than presenting a default as a choice.
   * @return source
   */

  @JsonProperty("source")
  public SourceEnum getSource() {
    return source;
  }

  @JsonProperty("source")
  public void setSource(SourceEnum source) {
    this.source = source;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PreferenceResponseDto preferenceResponseDto = (PreferenceResponseDto) o;
    return (
      Objects.equals(this.type, preferenceResponseDto.type) &&
      Objects.equals(this.channel, preferenceResponseDto.channel) &&
      Objects.equals(this.isEnabled, preferenceResponseDto.isEnabled) &&
      Objects.equals(this.digest, preferenceResponseDto.digest) &&
      Objects.equals(this.source, preferenceResponseDto.source)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(type, channel, isEnabled, digest, source);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PreferenceResponseDto {\n");
    sb.append("    type: ").append(toIndentedString(type)).append("\n");
    sb.append("    channel: ").append(toIndentedString(channel)).append("\n");
    sb.append("    isEnabled: ")
      .append(toIndentedString(isEnabled))
      .append("\n");
    sb.append("    digest: ").append(toIndentedString(digest)).append("\n");
    sb.append("    source: ").append(toIndentedString(source)).append("\n");
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

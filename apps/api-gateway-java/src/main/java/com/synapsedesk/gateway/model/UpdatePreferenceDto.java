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
import org.jspecify.annotations.Nullable;

/**
 * UpdatePreferenceDto
 */

public class UpdatePreferenceDto {

  /**
   * A known type, or `'*'` for the catch-all that turns a channel off wholesale.
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
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private TypeEnum type;

  /**
   * Gets or Sets channel
   */
  public enum ChannelEnum {
    EMAIL("EMAIL"),

    IN_APP("IN_APP"),

    PUSH("PUSH"),

    SMS("SMS");

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
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private ChannelEnum channel;

  private @Nullable Boolean isEnabled;

  /**
   * Gets or Sets digest
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
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable DigestEnum digest;

  public UpdatePreferenceDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UpdatePreferenceDto(TypeEnum type, ChannelEnum channel) {
    this.type = type;
    this.channel = channel;
  }

  public UpdatePreferenceDto type(TypeEnum type) {
    this.type = type;
    return this;
  }

  /**
   * A known type, or `'*'` for the catch-all that turns a channel off wholesale.
   * @return type
   */
  @NotNull
  @JsonProperty("type")
  public TypeEnum getType() {
    return type;
  }

  @JsonProperty("type")
  public void setType(TypeEnum type) {
    this.type = type;
  }

  public UpdatePreferenceDto channel(ChannelEnum channel) {
    this.channel = channel;
    return this;
  }

  /**
   * Get channel
   * @return channel
   */
  @NotNull
  @JsonProperty("channel")
  public ChannelEnum getChannel() {
    return channel;
  }

  @JsonProperty("channel")
  public void setChannel(ChannelEnum channel) {
    this.channel = channel;
  }

  public UpdatePreferenceDto isEnabled(@Nullable Boolean isEnabled) {
    this.isEnabled = isEnabled;
    return this;
  }

  /**
   * Get isEnabled
   * @return isEnabled
   */

  @JsonProperty("isEnabled")
  public @Nullable Boolean getIsEnabled() {
    return isEnabled;
  }

  @JsonProperty("isEnabled")
  public void setIsEnabled(@Nullable Boolean isEnabled) {
    this.isEnabled = isEnabled;
  }

  public UpdatePreferenceDto digest(@Nullable DigestEnum digest) {
    this.digest = digest;
    return this;
  }

  /**
   * Get digest
   * @return digest
   */

  @JsonProperty("digest")
  public @Nullable DigestEnum getDigest() {
    return digest;
  }

  @JsonProperty("digest")
  public void setDigest(@Nullable DigestEnum digest) {
    this.digest = digest;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdatePreferenceDto updatePreferenceDto = (UpdatePreferenceDto) o;
    return (
      Objects.equals(this.type, updatePreferenceDto.type) &&
      Objects.equals(this.channel, updatePreferenceDto.channel) &&
      Objects.equals(this.isEnabled, updatePreferenceDto.isEnabled) &&
      Objects.equals(this.digest, updatePreferenceDto.digest)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(type, channel, isEnabled, digest);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdatePreferenceDto {\n");
    sb.append("    type: ").append(toIndentedString(type)).append("\n");
    sb.append("    channel: ").append(toIndentedString(channel)).append("\n");
    sb.append("    isEnabled: ")
      .append(toIndentedString(isEnabled))
      .append("\n");
    sb.append("    digest: ").append(toIndentedString(digest)).append("\n");
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

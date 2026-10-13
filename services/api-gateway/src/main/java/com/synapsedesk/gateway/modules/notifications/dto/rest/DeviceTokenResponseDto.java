package com.synapsedesk.gateway.modules.notifications.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * DeviceTokenResponseDto
 */

public class DeviceTokenResponseDto {

  private String id;

  /**
   * `IOS` | `ANDROID` | `WEB` or `null` if the platform is not recognized.
   */
  public enum PlatformEnum {
    ANDROID("ANDROID"),

    IOS("IOS"),

    WEB("WEB");

    private final String value;

    PlatformEnum(String value) {
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
    public static PlatformEnum fromValue(String value) {
      for (PlatformEnum b : PlatformEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private PlatformEnum platform = null;

  private String deviceName = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime lastUsedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt = null;

  public DeviceTokenResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeviceTokenResponseDto(
    String id,
    PlatformEnum platform,
    String deviceName,
    OffsetDateTime lastUsedAt,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.platform = platform;
    this.deviceName = deviceName;
    this.lastUsedAt = lastUsedAt;
    this.createdAt = createdAt;
  }

  public DeviceTokenResponseDto id(String id) {
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

  public DeviceTokenResponseDto platform(PlatformEnum platform) {
    this.platform = platform;
    return this;
  }

  /**
   * `IOS` | `ANDROID` | `WEB` or `null` if the platform is not recognized.
   * @return platform
   */

  @JsonProperty("platform")
  public PlatformEnum getPlatform() {
    return platform;
  }

  @JsonProperty("platform")
  public void setPlatform(PlatformEnum platform) {
    this.platform = platform;
  }

  public DeviceTokenResponseDto deviceName(String deviceName) {
    this.deviceName = deviceName;
    return this;
  }

  /**
   * Get deviceName
   * @return deviceName
   */

  @JsonProperty("deviceName")
  public String getDeviceName() {
    return deviceName;
  }

  @JsonProperty("deviceName")
  public void setDeviceName(String deviceName) {
    this.deviceName = deviceName;
  }

  public DeviceTokenResponseDto lastUsedAt(OffsetDateTime lastUsedAt) {
    this.lastUsedAt = lastUsedAt;
    return this;
  }

  /**
   * Null until the first successful push — how stale this device is.
   * @return lastUsedAt
   */
  @Valid
  @JsonProperty("lastUsedAt")
  public OffsetDateTime getLastUsedAt() {
    return lastUsedAt;
  }

  @JsonProperty("lastUsedAt")
  public void setLastUsedAt(OffsetDateTime lastUsedAt) {
    this.lastUsedAt = lastUsedAt;
  }

  public DeviceTokenResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DeviceTokenResponseDto deviceTokenResponseDto = (DeviceTokenResponseDto) o;
    return (
      Objects.equals(this.id, deviceTokenResponseDto.id) &&
      Objects.equals(this.platform, deviceTokenResponseDto.platform) &&
      Objects.equals(this.deviceName, deviceTokenResponseDto.deviceName) &&
      Objects.equals(this.lastUsedAt, deviceTokenResponseDto.lastUsedAt) &&
      Objects.equals(this.createdAt, deviceTokenResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, platform, deviceName, lastUsedAt, createdAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeviceTokenResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    platform: ").append(toIndentedString(platform)).append("\n");
    sb.append("    deviceName: ")
      .append(toIndentedString(deviceName))
      .append("\n");
    sb.append("    lastUsedAt: ")
      .append(toIndentedString(lastUsedAt))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
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

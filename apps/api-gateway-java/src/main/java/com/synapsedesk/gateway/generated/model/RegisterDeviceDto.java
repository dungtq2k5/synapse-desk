package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * RegisterDeviceDto
 */

public class RegisterDeviceDto {

  private String token;

  /**
   * Gets or Sets platform
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
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private PlatformEnum platform;

  private @Nullable String deviceName;

  public RegisterDeviceDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RegisterDeviceDto(String token, PlatformEnum platform) {
    this.token = token;
    this.platform = platform;
  }

  public RegisterDeviceDto token(String token) {
    this.token = token;
    return this;
  }

  /**
   * Get token
   * @return token
   */
  @NotNull @Size(min = 1, max = 512) 
  @JsonProperty("token")
  public String getToken() {
    return token;
  }

  @JsonProperty("token")
  public void setToken(String token) {
    this.token = token;
  }

  public RegisterDeviceDto platform(PlatformEnum platform) {
    this.platform = platform;
    return this;
  }

  /**
   * Get platform
   * @return platform
   */
  @NotNull 
  @JsonProperty("platform")
  public PlatformEnum getPlatform() {
    return platform;
  }

  @JsonProperty("platform")
  public void setPlatform(PlatformEnum platform) {
    this.platform = platform;
  }

  public RegisterDeviceDto deviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
    return this;
  }

  /**
   * Get deviceName
   * @return deviceName
   */
  @Size(max = 100) 
  @JsonProperty("deviceName")
  public @Nullable String getDeviceName() {
    return deviceName;
  }

  @JsonProperty("deviceName")
  public void setDeviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RegisterDeviceDto registerDeviceDto = (RegisterDeviceDto) o;
    return Objects.equals(this.token, registerDeviceDto.token) &&
        Objects.equals(this.platform, registerDeviceDto.platform) &&
        Objects.equals(this.deviceName, registerDeviceDto.deviceName);
  }

  @Override
  public int hashCode() {
    return Objects.hash(token, platform, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RegisterDeviceDto {\n");
    sb.append("    token: ").append(toIndentedString(token)).append("\n");
    sb.append("    platform: ").append(toIndentedString(platform)).append("\n");
    sb.append("    deviceName: ").append(toIndentedString(deviceName)).append("\n");
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


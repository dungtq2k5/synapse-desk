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
 * AuthenticateTwoFactorDto
 */

public class AuthenticateTwoFactorDto {

  private @Nullable String backupCode;

  private Boolean rememberDevice = false;

  private @Nullable String code;

  private @Nullable String deviceName;

  public AuthenticateTwoFactorDto backupCode(@Nullable String backupCode) {
    this.backupCode = backupCode;
    return this;
  }

  /**
   * Get backupCode
   * @return backupCode
   */
  @Size(min = 1)
  @JsonProperty("backupCode")
  public @Nullable String getBackupCode() {
    return backupCode;
  }

  @JsonProperty("backupCode")
  public void setBackupCode(@Nullable String backupCode) {
    this.backupCode = backupCode;
  }

  public AuthenticateTwoFactorDto rememberDevice(Boolean rememberDevice) {
    this.rememberDevice = rememberDevice;
    return this;
  }

  /**
   * Get rememberDevice
   * @return rememberDevice
   */

  @JsonProperty("rememberDevice")
  public Boolean getRememberDevice() {
    return rememberDevice;
  }

  @JsonProperty("rememberDevice")
  public void setRememberDevice(Boolean rememberDevice) {
    this.rememberDevice = rememberDevice;
  }

  public AuthenticateTwoFactorDto code(@Nullable String code) {
    this.code = code;
    return this;
  }

  /**
   * Get code
   * @return code
   */
  @Size(min = 6, max = 6)
  @JsonProperty("code")
  public @Nullable String getCode() {
    return code;
  }

  @JsonProperty("code")
  public void setCode(@Nullable String code) {
    this.code = code;
  }

  public AuthenticateTwoFactorDto deviceName(@Nullable String deviceName) {
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
    AuthenticateTwoFactorDto authenticateTwoFactorDto =
      (AuthenticateTwoFactorDto) o;
    return (
      Objects.equals(this.backupCode, authenticateTwoFactorDto.backupCode) &&
      Objects.equals(
        this.rememberDevice,
        authenticateTwoFactorDto.rememberDevice
      ) &&
      Objects.equals(this.code, authenticateTwoFactorDto.code) &&
      Objects.equals(this.deviceName, authenticateTwoFactorDto.deviceName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(backupCode, rememberDevice, code, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AuthenticateTwoFactorDto {\n");
    sb.append("    backupCode: ")
      .append(toIndentedString(backupCode))
      .append("\n");
    sb.append("    rememberDevice: ")
      .append(toIndentedString(rememberDevice))
      .append("\n");
    sb.append("    code: ").append(toIndentedString(code)).append("\n");
    sb.append("    deviceName: ")
      .append(toIndentedString(deviceName))
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

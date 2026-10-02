package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * SessionResponseDto
 */

public class SessionResponseDto {

  private String id;

  private String deviceName = null;

  private String ipAddress;

  private String userAgent;

  private Boolean current;

  private Boolean isTrusted;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime trustedUntil = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public SessionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SessionResponseDto(
    String id,
    String deviceName,
    String ipAddress,
    String userAgent,
    Boolean current,
    Boolean isTrusted,
    OffsetDateTime trustedUntil,
    OffsetDateTime expiresAt,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.deviceName = deviceName;
    this.ipAddress = ipAddress;
    this.userAgent = userAgent;
    this.current = current;
    this.isTrusted = isTrusted;
    this.trustedUntil = trustedUntil;
    this.expiresAt = expiresAt;
    this.createdAt = createdAt;
  }

  public SessionResponseDto id(String id) {
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

  public SessionResponseDto deviceName(String deviceName) {
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

  public SessionResponseDto ipAddress(String ipAddress) {
    this.ipAddress = ipAddress;
    return this;
  }

  /**
   * Get ipAddress
   * @return ipAddress
   */
  @NotNull
  @JsonProperty("ipAddress")
  public String getIpAddress() {
    return ipAddress;
  }

  @JsonProperty("ipAddress")
  public void setIpAddress(String ipAddress) {
    this.ipAddress = ipAddress;
  }

  public SessionResponseDto userAgent(String userAgent) {
    this.userAgent = userAgent;
    return this;
  }

  /**
   * Get userAgent
   * @return userAgent
   */
  @NotNull
  @JsonProperty("userAgent")
  public String getUserAgent() {
    return userAgent;
  }

  @JsonProperty("userAgent")
  public void setUserAgent(String userAgent) {
    this.userAgent = userAgent;
  }

  public SessionResponseDto current(Boolean current) {
    this.current = current;
    return this;
  }

  /**
   * The session this request arrived on, matched by family — not by IP.
   * @return current
   */
  @NotNull
  @JsonProperty("current")
  public Boolean getCurrent() {
    return current;
  }

  @JsonProperty("current")
  public void setCurrent(Boolean current) {
    this.current = current;
  }

  public SessionResponseDto isTrusted(Boolean isTrusted) {
    this.isTrusted = isTrusted;
    return this;
  }

  /**
   * Get isTrusted
   * @return isTrusted
   */
  @NotNull
  @JsonProperty("isTrusted")
  public Boolean getIsTrusted() {
    return isTrusted;
  }

  @JsonProperty("isTrusted")
  public void setIsTrusted(Boolean isTrusted) {
    this.isTrusted = isTrusted;
  }

  public SessionResponseDto trustedUntil(OffsetDateTime trustedUntil) {
    this.trustedUntil = trustedUntil;
    return this;
  }

  /**
   * Get trustedUntil
   * @return trustedUntil
   */
  @Valid
  @JsonProperty("trustedUntil")
  public OffsetDateTime getTrustedUntil() {
    return trustedUntil;
  }

  @JsonProperty("trustedUntil")
  public void setTrustedUntil(OffsetDateTime trustedUntil) {
    this.trustedUntil = trustedUntil;
  }

  public SessionResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @NotNull
  @Valid
  @JsonProperty("expiresAt")
  public OffsetDateTime getExpiresAt() {
    return expiresAt;
  }

  @JsonProperty("expiresAt")
  public void setExpiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  public SessionResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
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
    SessionResponseDto sessionResponseDto = (SessionResponseDto) o;
    return (
      Objects.equals(this.id, sessionResponseDto.id) &&
      Objects.equals(this.deviceName, sessionResponseDto.deviceName) &&
      Objects.equals(this.ipAddress, sessionResponseDto.ipAddress) &&
      Objects.equals(this.userAgent, sessionResponseDto.userAgent) &&
      Objects.equals(this.current, sessionResponseDto.current) &&
      Objects.equals(this.isTrusted, sessionResponseDto.isTrusted) &&
      Objects.equals(this.trustedUntil, sessionResponseDto.trustedUntil) &&
      Objects.equals(this.expiresAt, sessionResponseDto.expiresAt) &&
      Objects.equals(this.createdAt, sessionResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      deviceName,
      ipAddress,
      userAgent,
      current,
      isTrusted,
      trustedUntil,
      expiresAt,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SessionResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    deviceName: ")
      .append(toIndentedString(deviceName))
      .append("\n");
    sb.append("    ipAddress: ")
      .append(toIndentedString(ipAddress))
      .append("\n");
    sb.append("    userAgent: ")
      .append(toIndentedString(userAgent))
      .append("\n");
    sb.append("    current: ").append(toIndentedString(current)).append("\n");
    sb.append("    isTrusted: ")
      .append(toIndentedString(isTrusted))
      .append("\n");
    sb.append("    trustedUntil: ")
      .append(toIndentedString(trustedUntil))
      .append("\n");
    sb.append("    expiresAt: ")
      .append(toIndentedString(expiresAt))
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

package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * AcceptInvitationDto
 */

public class AcceptInvitationDto {

  private String token;

  private String fullName;

  private String password;

  private @Nullable String deviceName;

  public AcceptInvitationDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AcceptInvitationDto(String token, String fullName, String password) {
    this.token = token;
    this.fullName = fullName;
    this.password = password;
  }

  public AcceptInvitationDto token(String token) {
    this.token = token;
    return this;
  }

  /**
   * Get token
   * @return token
   */
  @NotNull 
  @JsonProperty("token")
  public String getToken() {
    return token;
  }

  @JsonProperty("token")
  public void setToken(String token) {
    this.token = token;
  }

  public AcceptInvitationDto fullName(String fullName) {
    this.fullName = fullName;
    return this;
  }

  /**
   * Get fullName
   * @return fullName
   */
  @NotNull @Size(min = 1) 
  @JsonProperty("fullName")
  public String getFullName() {
    return fullName;
  }

  @JsonProperty("fullName")
  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public AcceptInvitationDto password(String password) {
    this.password = password;
    return this;
  }

  /**
   * Get password
   * @return password
   */
  @NotNull @Size(min = 12) 
  @JsonProperty("password")
  public String getPassword() {
    return password;
  }

  @JsonProperty("password")
  public void setPassword(String password) {
    this.password = password;
  }

  public AcceptInvitationDto deviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
    return this;
  }

  /**
   * Labels the session this call creates, in the user's active-device list.  Optional: the client sends what it can identify itself as, and a session with no label is still a session.
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
    AcceptInvitationDto acceptInvitationDto = (AcceptInvitationDto) o;
    return Objects.equals(this.token, acceptInvitationDto.token) &&
        Objects.equals(this.fullName, acceptInvitationDto.fullName) &&
        Objects.equals(this.password, acceptInvitationDto.password) &&
        Objects.equals(this.deviceName, acceptInvitationDto.deviceName);
  }

  @Override
  public int hashCode() {
    return Objects.hash(token, fullName, password, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AcceptInvitationDto {\n");
    sb.append("    token: ").append(toIndentedString(token)).append("\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    password: ").append(toIndentedString(password)).append("\n");
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


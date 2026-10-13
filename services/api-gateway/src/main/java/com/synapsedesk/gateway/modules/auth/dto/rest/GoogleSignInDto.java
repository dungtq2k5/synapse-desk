package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * GoogleSignInDto
 */

public class GoogleSignInDto {

  private String idToken;

  private @Nullable String deviceName;

  public GoogleSignInDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public GoogleSignInDto(String idToken) {
    this.idToken = idToken;
  }

  public GoogleSignInDto idToken(String idToken) {
    this.idToken = idToken;
    return this;
  }

  /**
   * The Firebase ID token the browser obtained from the Google flow.  Safe to accept from the body precisely because it is not trusted: auth-service verifies its signature against Google's public keys, so a forged value fails there rather than being believed here.
   * @return idToken
   */
  @NotNull
  @Size(min = 1)
  @JsonProperty("idToken")
  public String getIdToken() {
    return idToken;
  }

  @JsonProperty("idToken")
  public void setIdToken(String idToken) {
    this.idToken = idToken;
  }

  public GoogleSignInDto deviceName(@Nullable String deviceName) {
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
    GoogleSignInDto googleSignInDto = (GoogleSignInDto) o;
    return (
      Objects.equals(this.idToken, googleSignInDto.idToken) &&
      Objects.equals(this.deviceName, googleSignInDto.deviceName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(idToken, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class GoogleSignInDto {\n");
    sb.append("    idToken: ").append(toIndentedString(idToken)).append("\n");
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

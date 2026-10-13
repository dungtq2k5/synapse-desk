package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * LoginDto
 */

public class LoginDto {

  private String password;

  private String email;

  private @Nullable String deviceName;

  public LoginDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public LoginDto(String password, String email) {
    this.password = password;
    this.email = email;
  }

  public LoginDto password(String password) {
    this.password = password;
    return this;
  }

  /**
   * Get password
   * @return password
   */
  @NotNull
  @Size(min = 1)
  @JsonProperty("password")
  public String getPassword() {
    return password;
  }

  @JsonProperty("password")
  public void setPassword(String password) {
    this.password = password;
  }

  public LoginDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @jakarta.validation.constraints.Email
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public LoginDto deviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
    return this;
  }

  /**
   * Display label for the \"your active sessions\" screen (\"Chrome on macOS\").  Its destination is `device_sessions.device_name`, written when the session row is created — which is why it looks unused in `login()`. Being client-supplied, it must never influence a security decision: device trust is proven with the separate `deviceToken` cookie, a secret the server issued.  `@MaxLength(100)` mirrors `device_sessions.device_name VarChar(100)`; without it an oversized value is a Postgres error on insert rather than a 400 at the edge.  Optional rather than nullable: absent means \"the client did not label this device\", which is what the proto's `optional string` expects.  **There is deliberately no `ipAddress` field.** A body field is whatever the client says it is, so accepting one would let an attacker post `{\"ipAddress\": \"10.0.0.1\"}` to poison the audit trail and evade IP-based lockout. The gateway derives it from the transport.
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
    LoginDto loginDto = (LoginDto) o;
    return (
      Objects.equals(this.password, loginDto.password) &&
      Objects.equals(this.email, loginDto.email) &&
      Objects.equals(this.deviceName, loginDto.deviceName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(password, email, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LoginDto {\n");
    sb.append("    password: ").append(toIndentedString(password)).append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
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

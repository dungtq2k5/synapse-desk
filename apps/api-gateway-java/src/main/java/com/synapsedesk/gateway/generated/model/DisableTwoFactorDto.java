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
 * DisableTwoFactorDto
 */

public class DisableTwoFactorDto {

  private String password;

  private String code;

  public DisableTwoFactorDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DisableTwoFactorDto(String password, String code) {
    this.password = password;
    this.code = code;
  }

  public DisableTwoFactorDto password(String password) {
    this.password = password;
    return this;
  }

  /**
   * Get password
   * @return password
   */
  @NotNull @Size(min = 1) 
  @JsonProperty("password")
  public String getPassword() {
    return password;
  }

  @JsonProperty("password")
  public void setPassword(String password) {
    this.password = password;
  }

  public DisableTwoFactorDto code(String code) {
    this.code = code;
    return this;
  }

  /**
   * Get code
   * @return code
   */
  @NotNull @Size(min = 6, max = 6) 
  @JsonProperty("code")
  public String getCode() {
    return code;
  }

  @JsonProperty("code")
  public void setCode(String code) {
    this.code = code;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DisableTwoFactorDto disableTwoFactorDto = (DisableTwoFactorDto) o;
    return Objects.equals(this.password, disableTwoFactorDto.password) &&
        Objects.equals(this.code, disableTwoFactorDto.code);
  }

  @Override
  public int hashCode() {
    return Objects.hash(password, code);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DisableTwoFactorDto {\n");
    sb.append("    password: ").append(toIndentedString(password)).append("\n");
    sb.append("    code: ").append(toIndentedString(code)).append("\n");
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


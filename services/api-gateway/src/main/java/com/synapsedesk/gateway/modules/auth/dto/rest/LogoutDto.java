package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * LogoutDto
 */

public class LogoutDto {

  private @Nullable Boolean allDevices;

  public LogoutDto allDevices(@Nullable Boolean allDevices) {
    this.allDevices = allDevices;
    return this;
  }

  /**
   * Log out of all devices.
   * @return allDevices
   */

  @JsonProperty("allDevices")
  public @Nullable Boolean getAllDevices() {
    return allDevices;
  }

  @JsonProperty("allDevices")
  public void setAllDevices(@Nullable Boolean allDevices) {
    this.allDevices = allDevices;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    LogoutDto logoutDto = (LogoutDto) o;
    return Objects.equals(this.allDevices, logoutDto.allDevices);
  }

  @Override
  public int hashCode() {
    return Objects.hash(allDevices);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LogoutDto {\n");
    sb.append("    allDevices: ")
      .append(toIndentedString(allDevices))
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

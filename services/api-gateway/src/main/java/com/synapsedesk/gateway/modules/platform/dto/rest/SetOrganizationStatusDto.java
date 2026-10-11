package com.synapsedesk.gateway.modules.platform.dto.rest;

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
 * SetOrganizationStatusDto
 */

public class SetOrganizationStatusDto {

  private String reason;

  /**
   * Gets or Sets status
   */
  public enum StatusEnum {
    ACTIVE("ACTIVE"),

    FROZEN("FROZEN"),

    PENDING_ONBOARDING("PENDING_ONBOARDING"),

    SUSPENDED_PAST_DUE("SUSPENDED_PAST_DUE");

    private final String value;

    StatusEnum(String value) {
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
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private StatusEnum status;

  public SetOrganizationStatusDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SetOrganizationStatusDto(String reason, StatusEnum status) {
    this.reason = reason;
    this.status = status;
  }

  public SetOrganizationStatusDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Required — the audit row is read months later by someone who was not there.
   * @return reason
   */
  @NotNull
  @Size(min = 1, max = 500)
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  public SetOrganizationStatusDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
   * @return status
   */
  @NotNull
  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SetOrganizationStatusDto setOrganizationStatusDto =
      (SetOrganizationStatusDto) o;
    return (
      Objects.equals(this.reason, setOrganizationStatusDto.reason) &&
      Objects.equals(this.status, setOrganizationStatusDto.status)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(reason, status);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SetOrganizationStatusDto {\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
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

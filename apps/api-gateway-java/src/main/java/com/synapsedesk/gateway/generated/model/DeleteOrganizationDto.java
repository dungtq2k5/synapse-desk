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
 * DeleteOrganizationDto
 */

public class DeleteOrganizationDto {

  private String reason;

  public DeleteOrganizationDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeleteOrganizationDto(String reason) {
    this.reason = reason;
  }

  public DeleteOrganizationDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Required. Offboarding is finalized by a Super Admin who was not in the room, and \"why did Acme leave?\" is the first thing they will ask.
   * @return reason
   */
  @NotNull @Size(min = 1, max = 500) 
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DeleteOrganizationDto deleteOrganizationDto = (DeleteOrganizationDto) o;
    return Objects.equals(this.reason, deleteOrganizationDto.reason);
  }

  @Override
  public int hashCode() {
    return Objects.hash(reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeleteOrganizationDto {\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
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


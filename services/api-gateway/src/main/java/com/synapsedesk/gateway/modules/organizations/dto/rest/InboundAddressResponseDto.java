package com.synapsedesk.gateway.modules.organizations.dto.rest;

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
 * InboundAddressResponseDto
 */

public class InboundAddressResponseDto {

  private String inboundAddress;

  public InboundAddressResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InboundAddressResponseDto(String inboundAddress) {
    this.inboundAddress = inboundAddress;
  }

  public InboundAddressResponseDto inboundAddress(String inboundAddress) {
    this.inboundAddress = inboundAddress;
    return this;
  }

  /**
   * Publish this as the tenant’s support address. Rotating it issues a new one and stops the previous address routing immediately.
   * @return inboundAddress
   */
  @NotNull
  @JsonProperty("inboundAddress")
  public String getInboundAddress() {
    return inboundAddress;
  }

  @JsonProperty("inboundAddress")
  public void setInboundAddress(String inboundAddress) {
    this.inboundAddress = inboundAddress;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    InboundAddressResponseDto inboundAddressResponseDto =
      (InboundAddressResponseDto) o;
    return Objects.equals(
      this.inboundAddress,
      inboundAddressResponseDto.inboundAddress
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(inboundAddress);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InboundAddressResponseDto {\n");
    sb.append("    inboundAddress: ")
      .append(toIndentedString(inboundAddress))
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

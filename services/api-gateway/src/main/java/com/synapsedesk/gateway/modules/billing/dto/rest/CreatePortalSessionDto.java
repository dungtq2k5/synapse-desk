package com.synapsedesk.gateway.modules.billing.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreatePortalSessionDto
 */

public class CreatePortalSessionDto {

  private URI returnUrl;

  public CreatePortalSessionDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreatePortalSessionDto(URI returnUrl) {
    this.returnUrl = returnUrl;
  }

  public CreatePortalSessionDto returnUrl(URI returnUrl) {
    this.returnUrl = returnUrl;
    return this;
  }

  /**
   * Get returnUrl
   * @return returnUrl
   */
  @NotNull
  @Valid
  @JsonProperty("returnUrl")
  public URI getReturnUrl() {
    return returnUrl;
  }

  @JsonProperty("returnUrl")
  public void setReturnUrl(URI returnUrl) {
    this.returnUrl = returnUrl;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreatePortalSessionDto createPortalSessionDto = (CreatePortalSessionDto) o;
    return Objects.equals(this.returnUrl, createPortalSessionDto.returnUrl);
  }

  @Override
  public int hashCode() {
    return Objects.hash(returnUrl);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreatePortalSessionDto {\n");
    sb.append("    returnUrl: ")
      .append(toIndentedString(returnUrl))
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

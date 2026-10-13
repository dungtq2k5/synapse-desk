package com.synapsedesk.gateway.modules.billing.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreateCheckoutSessionDto
 */

public class CreateCheckoutSessionDto {

  private String priceId;

  private URI successUrl;

  private URI cancelUrl;

  public CreateCheckoutSessionDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateCheckoutSessionDto(
    String priceId,
    URI successUrl,
    URI cancelUrl
  ) {
    this.priceId = priceId;
    this.successUrl = successUrl;
    this.cancelUrl = cancelUrl;
  }

  public CreateCheckoutSessionDto priceId(String priceId) {
    this.priceId = priceId;
    return this;
  }

  /**
   * Get priceId
   * @return priceId
   */
  @NotNull
  @Size(min = 1, max = 255)
  @JsonProperty("priceId")
  public String getPriceId() {
    return priceId;
  }

  @JsonProperty("priceId")
  public void setPriceId(String priceId) {
    this.priceId = priceId;
  }

  public CreateCheckoutSessionDto successUrl(URI successUrl) {
    this.successUrl = successUrl;
    return this;
  }

  /**
   * Get successUrl
   * @return successUrl
   */
  @NotNull
  @Valid
  @JsonProperty("successUrl")
  public URI getSuccessUrl() {
    return successUrl;
  }

  @JsonProperty("successUrl")
  public void setSuccessUrl(URI successUrl) {
    this.successUrl = successUrl;
  }

  public CreateCheckoutSessionDto cancelUrl(URI cancelUrl) {
    this.cancelUrl = cancelUrl;
    return this;
  }

  /**
   * Get cancelUrl
   * @return cancelUrl
   */
  @NotNull
  @Valid
  @JsonProperty("cancelUrl")
  public URI getCancelUrl() {
    return cancelUrl;
  }

  @JsonProperty("cancelUrl")
  public void setCancelUrl(URI cancelUrl) {
    this.cancelUrl = cancelUrl;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateCheckoutSessionDto createCheckoutSessionDto =
      (CreateCheckoutSessionDto) o;
    return (
      Objects.equals(this.priceId, createCheckoutSessionDto.priceId) &&
      Objects.equals(this.successUrl, createCheckoutSessionDto.successUrl) &&
      Objects.equals(this.cancelUrl, createCheckoutSessionDto.cancelUrl)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(priceId, successUrl, cancelUrl);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateCheckoutSessionDto {\n");
    sb.append("    priceId: ").append(toIndentedString(priceId)).append("\n");
    sb.append("    successUrl: ")
      .append(toIndentedString(successUrl))
      .append("\n");
    sb.append("    cancelUrl: ")
      .append(toIndentedString(cancelUrl))
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

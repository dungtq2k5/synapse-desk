package com.synapsedesk.gateway.modules.webhookendpoints.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * WebhookEndpointWithSecretResponseDto
 */

public class WebhookEndpointWithSecretResponseDto {

  private WebhookEndpointResponseDto endpoint;

  private String secret;

  public WebhookEndpointWithSecretResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public WebhookEndpointWithSecretResponseDto(
    WebhookEndpointResponseDto endpoint,
    String secret
  ) {
    this.endpoint = endpoint;
    this.secret = secret;
  }

  public WebhookEndpointWithSecretResponseDto endpoint(
    WebhookEndpointResponseDto endpoint
  ) {
    this.endpoint = endpoint;
    return this;
  }

  /**
   * Get endpoint
   * @return endpoint
   */
  @NotNull
  @Valid
  @JsonProperty("endpoint")
  public WebhookEndpointResponseDto getEndpoint() {
    return endpoint;
  }

  @JsonProperty("endpoint")
  public void setEndpoint(WebhookEndpointResponseDto endpoint) {
    this.endpoint = endpoint;
  }

  public WebhookEndpointWithSecretResponseDto secret(String secret) {
    this.secret = secret;
    return this;
  }

  /**
   * `whsec_…` — store it now; no read returns it again.
   * @return secret
   */
  @NotNull
  @JsonProperty("secret")
  public String getSecret() {
    return secret;
  }

  @JsonProperty("secret")
  public void setSecret(String secret) {
    this.secret = secret;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    WebhookEndpointWithSecretResponseDto webhookEndpointWithSecretResponseDto =
      (WebhookEndpointWithSecretResponseDto) o;
    return (
      Objects.equals(
        this.endpoint,
        webhookEndpointWithSecretResponseDto.endpoint
      ) &&
      Objects.equals(this.secret, webhookEndpointWithSecretResponseDto.secret)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(endpoint, secret);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class WebhookEndpointWithSecretResponseDto {\n");
    sb.append("    endpoint: ").append(toIndentedString(endpoint)).append("\n");
    sb.append("    secret: ").append(toIndentedString(secret)).append("\n");
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

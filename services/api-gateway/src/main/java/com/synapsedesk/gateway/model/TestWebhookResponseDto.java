package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * TestWebhookResponseDto
 */

public class TestWebhookResponseDto {

  private Boolean delivered;

  private BigDecimal responseStatus = null;

  private String error = null;

  public TestWebhookResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TestWebhookResponseDto(
    Boolean delivered,
    BigDecimal responseStatus,
    String error
  ) {
    this.delivered = delivered;
    this.responseStatus = responseStatus;
    this.error = error;
  }

  public TestWebhookResponseDto delivered(Boolean delivered) {
    this.delivered = delivered;
    return this;
  }

  /**
   * Get delivered
   * @return delivered
   */
  @NotNull
  @JsonProperty("delivered")
  public Boolean getDelivered() {
    return delivered;
  }

  @JsonProperty("delivered")
  public void setDelivered(Boolean delivered) {
    this.delivered = delivered;
  }

  public TestWebhookResponseDto responseStatus(BigDecimal responseStatus) {
    this.responseStatus = responseStatus;
    return this;
  }

  /**
   * Get responseStatus
   * @return responseStatus
   */
  @Valid
  @JsonProperty("responseStatus")
  public BigDecimal getResponseStatus() {
    return responseStatus;
  }

  @JsonProperty("responseStatus")
  public void setResponseStatus(BigDecimal responseStatus) {
    this.responseStatus = responseStatus;
  }

  public TestWebhookResponseDto error(String error) {
    this.error = error;
    return this;
  }

  /**
   * Get error
   * @return error
   */

  @JsonProperty("error")
  public String getError() {
    return error;
  }

  @JsonProperty("error")
  public void setError(String error) {
    this.error = error;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TestWebhookResponseDto testWebhookResponseDto = (TestWebhookResponseDto) o;
    return (
      Objects.equals(this.delivered, testWebhookResponseDto.delivered) &&
      Objects.equals(
        this.responseStatus,
        testWebhookResponseDto.responseStatus
      ) &&
      Objects.equals(this.error, testWebhookResponseDto.error)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(delivered, responseStatus, error);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TestWebhookResponseDto {\n");
    sb.append("    delivered: ")
      .append(toIndentedString(delivered))
      .append("\n");
    sb.append("    responseStatus: ")
      .append(toIndentedString(responseStatus))
      .append("\n");
    sb.append("    error: ").append(toIndentedString(error)).append("\n");
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

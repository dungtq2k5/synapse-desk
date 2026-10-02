package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * DeleteWebhookEndpointResponseDto
 */

public class DeleteWebhookEndpointResponseDto {

  private Boolean deleted;

  public DeleteWebhookEndpointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeleteWebhookEndpointResponseDto(Boolean deleted) {
    this.deleted = deleted;
  }

  public DeleteWebhookEndpointResponseDto deleted(Boolean deleted) {
    this.deleted = deleted;
    return this;
  }

  /**
   * Get deleted
   * @return deleted
   */
  @NotNull
  @JsonProperty("deleted")
  public Boolean getDeleted() {
    return deleted;
  }

  @JsonProperty("deleted")
  public void setDeleted(Boolean deleted) {
    this.deleted = deleted;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DeleteWebhookEndpointResponseDto deleteWebhookEndpointResponseDto =
      (DeleteWebhookEndpointResponseDto) o;
    return Objects.equals(
      this.deleted,
      deleteWebhookEndpointResponseDto.deleted
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(deleted);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeleteWebhookEndpointResponseDto {\n");
    sb.append("    deleted: ").append(toIndentedString(deleted)).append("\n");
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

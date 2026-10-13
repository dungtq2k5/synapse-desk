package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * BulkTicketStatusResponseDto
 */

public class BulkTicketStatusResponseDto {

  private List<String> updated = new ArrayList<>();

  private List<@Valid BulkTicketFailureResponseDto> failed = new ArrayList<>();

  public BulkTicketStatusResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BulkTicketStatusResponseDto(
    List<String> updated,
    List<@Valid BulkTicketFailureResponseDto> failed
  ) {
    this.updated = updated;
    this.failed = failed;
  }

  public BulkTicketStatusResponseDto updated(List<String> updated) {
    this.updated = updated;
    return this;
  }

  public BulkTicketStatusResponseDto addUpdatedItem(String updatedItem) {
    if (this.updated == null) {
      this.updated = new ArrayList<>();
    }
    this.updated.add(updatedItem);
    return this;
  }

  /**
   * Get updated
   * @return updated
   */
  @NotNull
  @JsonProperty("updated")
  public List<String> getUpdated() {
    return updated;
  }

  @JsonProperty("updated")
  public void setUpdated(List<String> updated) {
    this.updated = updated;
  }

  public BulkTicketStatusResponseDto failed(
    List<@Valid BulkTicketFailureResponseDto> failed
  ) {
    this.failed = failed;
    return this;
  }

  public BulkTicketStatusResponseDto addFailedItem(
    BulkTicketFailureResponseDto failedItem
  ) {
    if (this.failed == null) {
      this.failed = new ArrayList<>();
    }
    this.failed.add(failedItem);
    return this;
  }

  /**
   * Get failed
   * @return failed
   */
  @NotNull
  @Valid
  @JsonProperty("failed")
  public List<@Valid BulkTicketFailureResponseDto> getFailed() {
    return failed;
  }

  @JsonProperty("failed")
  public void setFailed(List<@Valid BulkTicketFailureResponseDto> failed) {
    this.failed = failed;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BulkTicketStatusResponseDto bulkTicketStatusResponseDto =
      (BulkTicketStatusResponseDto) o;
    return (
      Objects.equals(this.updated, bulkTicketStatusResponseDto.updated) &&
      Objects.equals(this.failed, bulkTicketStatusResponseDto.failed)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(updated, failed);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BulkTicketStatusResponseDto {\n");
    sb.append("    updated: ").append(toIndentedString(updated)).append("\n");
    sb.append("    failed: ").append(toIndentedString(failed)).append("\n");
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

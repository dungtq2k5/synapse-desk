package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.BulkTicketFailureResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * BulkTicketPriorityResponseDto
 */

public class BulkTicketPriorityResponseDto {

  private List<String> updated = new ArrayList<>();

  private List<@Valid BulkTicketFailureResponseDto> failed = new ArrayList<>();

  public BulkTicketPriorityResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BulkTicketPriorityResponseDto(
    List<String> updated,
    List<@Valid BulkTicketFailureResponseDto> failed
  ) {
    this.updated = updated;
    this.failed = failed;
  }

  public BulkTicketPriorityResponseDto updated(List<String> updated) {
    this.updated = updated;
    return this;
  }

  public BulkTicketPriorityResponseDto addUpdatedItem(String updatedItem) {
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

  public BulkTicketPriorityResponseDto failed(
    List<@Valid BulkTicketFailureResponseDto> failed
  ) {
    this.failed = failed;
    return this;
  }

  public BulkTicketPriorityResponseDto addFailedItem(
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
    BulkTicketPriorityResponseDto bulkTicketPriorityResponseDto =
      (BulkTicketPriorityResponseDto) o;
    return (
      Objects.equals(this.updated, bulkTicketPriorityResponseDto.updated) &&
      Objects.equals(this.failed, bulkTicketPriorityResponseDto.failed)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(updated, failed);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BulkTicketPriorityResponseDto {\n");
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

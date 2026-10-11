package com.synapsedesk.gateway.modules.invitations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.invitations.dto.rest.FailedInvitationResponseDto;
import com.synapsedesk.gateway.modules.invitations.dto.rest.InvitationResponseDto;
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
 * CreateInvitationsResponseDto
 */

public class CreateInvitationsResponseDto {

  private List<@Valid InvitationResponseDto> created = new ArrayList<>();

  private List<@Valid FailedInvitationResponseDto> failed = new ArrayList<>();

  private String batchId = null;

  public CreateInvitationsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateInvitationsResponseDto(
    List<@Valid InvitationResponseDto> created,
    List<@Valid FailedInvitationResponseDto> failed,
    String batchId
  ) {
    this.created = created;
    this.failed = failed;
    this.batchId = batchId;
  }

  public CreateInvitationsResponseDto created(
    List<@Valid InvitationResponseDto> created
  ) {
    this.created = created;
    return this;
  }

  public CreateInvitationsResponseDto addCreatedItem(
    InvitationResponseDto createdItem
  ) {
    if (this.created == null) {
      this.created = new ArrayList<>();
    }
    this.created.add(createdItem);
    return this;
  }

  /**
   * Get created
   * @return created
   */
  @NotNull
  @Valid
  @JsonProperty("created")
  public List<@Valid InvitationResponseDto> getCreated() {
    return created;
  }

  @JsonProperty("created")
  public void setCreated(List<@Valid InvitationResponseDto> created) {
    this.created = created;
  }

  public CreateInvitationsResponseDto failed(
    List<@Valid FailedInvitationResponseDto> failed
  ) {
    this.failed = failed;
    return this;
  }

  public CreateInvitationsResponseDto addFailedItem(
    FailedInvitationResponseDto failedItem
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
  public List<@Valid FailedInvitationResponseDto> getFailed() {
    return failed;
  }

  @JsonProperty("failed")
  public void setFailed(List<@Valid FailedInvitationResponseDto> failed) {
    this.failed = failed;
  }

  public CreateInvitationsResponseDto batchId(String batchId) {
    this.batchId = batchId;
    return this;
  }

  /**
   * Get batchId
   * @return batchId
   */

  @JsonProperty("batchId")
  public String getBatchId() {
    return batchId;
  }

  @JsonProperty("batchId")
  public void setBatchId(String batchId) {
    this.batchId = batchId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateInvitationsResponseDto createInvitationsResponseDto =
      (CreateInvitationsResponseDto) o;
    return (
      Objects.equals(this.created, createInvitationsResponseDto.created) &&
      Objects.equals(this.failed, createInvitationsResponseDto.failed) &&
      Objects.equals(this.batchId, createInvitationsResponseDto.batchId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(created, failed, batchId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateInvitationsResponseDto {\n");
    sb.append("    created: ").append(toIndentedString(created)).append("\n");
    sb.append("    failed: ").append(toIndentedString(failed)).append("\n");
    sb.append("    batchId: ").append(toIndentedString(batchId)).append("\n");
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

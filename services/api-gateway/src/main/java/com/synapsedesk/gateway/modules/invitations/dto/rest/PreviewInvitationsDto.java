package com.synapsedesk.gateway.modules.invitations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.invitations.dto.rest.PreviewInviteUserDto;
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
 * PreviewInvitationsDto
 */

public class PreviewInvitationsDto {

  private List<@Valid PreviewInviteUserDto> invitations = new ArrayList<>();

  public PreviewInvitationsDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PreviewInvitationsDto(List<@Valid PreviewInviteUserDto> invitations) {
    this.invitations = invitations;
  }

  public PreviewInvitationsDto invitations(
    List<@Valid PreviewInviteUserDto> invitations
  ) {
    this.invitations = invitations;
    return this;
  }

  public PreviewInvitationsDto addInvitationsItem(
    PreviewInviteUserDto invitationsItem
  ) {
    if (this.invitations == null) {
      this.invitations = new ArrayList<>();
    }
    this.invitations.add(invitationsItem);
    return this;
  }

  /**
   * Get invitations
   * @return invitations
   */
  @NotNull
  @Valid
  @Size(min = 1)
  @JsonProperty("invitations")
  public List<@Valid PreviewInviteUserDto> getInvitations() {
    return invitations;
  }

  @JsonProperty("invitations")
  public void setInvitations(List<@Valid PreviewInviteUserDto> invitations) {
    this.invitations = invitations;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PreviewInvitationsDto previewInvitationsDto = (PreviewInvitationsDto) o;
    return Objects.equals(this.invitations, previewInvitationsDto.invitations);
  }

  @Override
  public int hashCode() {
    return Objects.hash(invitations);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PreviewInvitationsDto {\n");
    sb.append("    invitations: ")
      .append(toIndentedString(invitations))
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

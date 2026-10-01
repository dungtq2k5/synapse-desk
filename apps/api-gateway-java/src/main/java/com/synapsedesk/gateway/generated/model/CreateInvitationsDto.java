package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.synapsedesk.gateway.generated.model.InviteUserDto;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * CreateInvitationsDto
 */

public class CreateInvitationsDto {

  private List<@Valid InviteUserDto> invitations = new ArrayList<>();

  public CreateInvitationsDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateInvitationsDto(List<@Valid InviteUserDto> invitations) {
    this.invitations = invitations;
  }

  public CreateInvitationsDto invitations(List<@Valid InviteUserDto> invitations) {
    this.invitations = invitations;
    return this;
  }

  public CreateInvitationsDto addInvitationsItem(InviteUserDto invitationsItem) {
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
  @NotNull @Valid @Size(min = 1) 
  @JsonProperty("invitations")
  public List<@Valid InviteUserDto> getInvitations() {
    return invitations;
  }

  @JsonProperty("invitations")
  public void setInvitations(List<@Valid InviteUserDto> invitations) {
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
    CreateInvitationsDto createInvitationsDto = (CreateInvitationsDto) o;
    return Objects.equals(this.invitations, createInvitationsDto.invitations);
  }

  @Override
  public int hashCode() {
    return Objects.hash(invitations);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateInvitationsDto {\n");
    sb.append("    invitations: ").append(toIndentedString(invitations)).append("\n");
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


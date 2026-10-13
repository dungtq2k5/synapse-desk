package com.synapsedesk.gateway.modules.invitations.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * InvitationPreviewRowResponseDto
 */

public class InvitationPreviewRowResponseDto {

  private String email;

  private Boolean ok;

  private String reason = null;

  private List<String> unknownRoleIds = new ArrayList<>();

  private List<String> unknownDepartmentIds = new ArrayList<>();

  public InvitationPreviewRowResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InvitationPreviewRowResponseDto(
    String email,
    Boolean ok,
    String reason,
    List<String> unknownRoleIds,
    List<String> unknownDepartmentIds
  ) {
    this.email = email;
    this.ok = ok;
    this.reason = reason;
    this.unknownRoleIds = unknownRoleIds;
    this.unknownDepartmentIds = unknownDepartmentIds;
  }

  public InvitationPreviewRowResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public InvitationPreviewRowResponseDto ok(Boolean ok) {
    this.ok = ok;
    return this;
  }

  /**
   * Get ok
   * @return ok
   */
  @NotNull
  @JsonProperty("ok")
  public Boolean getOk() {
    return ok;
  }

  @JsonProperty("ok")
  public void setOk(Boolean ok) {
    this.ok = ok;
  }

  public InvitationPreviewRowResponseDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */

  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  public InvitationPreviewRowResponseDto unknownRoleIds(
    List<String> unknownRoleIds
  ) {
    this.unknownRoleIds = unknownRoleIds;
    return this;
  }

  public InvitationPreviewRowResponseDto addUnknownRoleIdsItem(
    String unknownRoleIdsItem
  ) {
    if (this.unknownRoleIds == null) {
      this.unknownRoleIds = new ArrayList<>();
    }
    this.unknownRoleIds.add(unknownRoleIdsItem);
    return this;
  }

  /**
   * Reported even on an OK row: these are skipped at redemption, not fatal.
   * @return unknownRoleIds
   */
  @NotNull
  @JsonProperty("unknownRoleIds")
  public List<String> getUnknownRoleIds() {
    return unknownRoleIds;
  }

  @JsonProperty("unknownRoleIds")
  public void setUnknownRoleIds(List<String> unknownRoleIds) {
    this.unknownRoleIds = unknownRoleIds;
  }

  public InvitationPreviewRowResponseDto unknownDepartmentIds(
    List<String> unknownDepartmentIds
  ) {
    this.unknownDepartmentIds = unknownDepartmentIds;
    return this;
  }

  public InvitationPreviewRowResponseDto addUnknownDepartmentIdsItem(
    String unknownDepartmentIdsItem
  ) {
    if (this.unknownDepartmentIds == null) {
      this.unknownDepartmentIds = new ArrayList<>();
    }
    this.unknownDepartmentIds.add(unknownDepartmentIdsItem);
    return this;
  }

  /**
   * Get unknownDepartmentIds
   * @return unknownDepartmentIds
   */
  @NotNull
  @JsonProperty("unknownDepartmentIds")
  public List<String> getUnknownDepartmentIds() {
    return unknownDepartmentIds;
  }

  @JsonProperty("unknownDepartmentIds")
  public void setUnknownDepartmentIds(List<String> unknownDepartmentIds) {
    this.unknownDepartmentIds = unknownDepartmentIds;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    InvitationPreviewRowResponseDto invitationPreviewRowResponseDto =
      (InvitationPreviewRowResponseDto) o;
    return (
      Objects.equals(this.email, invitationPreviewRowResponseDto.email) &&
      Objects.equals(this.ok, invitationPreviewRowResponseDto.ok) &&
      Objects.equals(this.reason, invitationPreviewRowResponseDto.reason) &&
      Objects.equals(
        this.unknownRoleIds,
        invitationPreviewRowResponseDto.unknownRoleIds
      ) &&
      Objects.equals(
        this.unknownDepartmentIds,
        invitationPreviewRowResponseDto.unknownDepartmentIds
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      email,
      ok,
      reason,
      unknownRoleIds,
      unknownDepartmentIds
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InvitationPreviewRowResponseDto {\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    ok: ").append(toIndentedString(ok)).append("\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    unknownRoleIds: ")
      .append(toIndentedString(unknownRoleIds))
      .append("\n");
    sb.append("    unknownDepartmentIds: ")
      .append(toIndentedString(unknownDepartmentIds))
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

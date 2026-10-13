package com.synapsedesk.gateway.modules.auditlogs.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AuditActionsResponseDto
 */

public class AuditActionsResponseDto {

  /**
   * Gets or Sets actions
   */
  public enum ActionsEnum {
    DATA_EXPORT_REQUESTED("DATA_EXPORT_REQUESTED"),

    DEPARTMENT_CREATED("DEPARTMENT_CREATED"),

    DEPARTMENT_DELETED("DEPARTMENT_DELETED"),

    DEPARTMENT_MEMBERS_ADDED("DEPARTMENT_MEMBERS_ADDED"),

    DEPARTMENT_MEMBER_REMOVED("DEPARTMENT_MEMBER_REMOVED"),

    DEPARTMENT_RESTORED("DEPARTMENT_RESTORED"),

    DEPARTMENT_UPDATED("DEPARTMENT_UPDATED"),

    DOCUMENT_FLAG_DELETED("DOCUMENT_FLAG_DELETED"),

    DOCUMENT_FLAG_DISMISSED("DOCUMENT_FLAG_DISMISSED"),

    DOCUMENT_FLAG_RESOLVED("DOCUMENT_FLAG_RESOLVED"),

    ORGANIZATION_OFFBOARD_REQUESTED("ORGANIZATION_OFFBOARD_REQUESTED"),

    ORGANIZATION_ONBOARDING_COMPLETED("ORGANIZATION_ONBOARDING_COMPLETED"),

    ORGANIZATION_SETTINGS_UPDATED("ORGANIZATION_SETTINGS_UPDATED"),

    ORGANIZATION_UPDATED("ORGANIZATION_UPDATED"),

    PASSWORD_CHANGED("PASSWORD_CHANGED"),

    PLATFORM_BILLING_CYCLE_RESET("PLATFORM_BILLING_CYCLE_RESET"),

    PLATFORM_GLOBAL_ROLE_CREATED("PLATFORM_GLOBAL_ROLE_CREATED"),

    PLATFORM_ORGANIZATION_CREATED("PLATFORM_ORGANIZATION_CREATED"),

    PLATFORM_ORGANIZATION_OFFBOARDED("PLATFORM_ORGANIZATION_OFFBOARDED"),

    PLATFORM_ORGANIZATION_RESTORED("PLATFORM_ORGANIZATION_RESTORED"),

    PLATFORM_ORGANIZATION_STATUS_CHANGED(
      "PLATFORM_ORGANIZATION_STATUS_CHANGED"
    ),

    PLATFORM_ORGANIZATION_UPDATED("PLATFORM_ORGANIZATION_UPDATED"),

    PLATFORM_PLAN_APPLIED("PLATFORM_PLAN_APPLIED"),

    PLATFORM_PLAN_CREATED("PLATFORM_PLAN_CREATED"),

    PLATFORM_PLAN_DELETED("PLATFORM_PLAN_DELETED"),

    PLATFORM_PLAN_UPDATED("PLATFORM_PLAN_UPDATED"),

    ROLE_CREATED("ROLE_CREATED"),

    ROLE_DELETED("ROLE_DELETED"),

    ROLE_PERMISSIONS_UPDATED("ROLE_PERMISSIONS_UPDATED"),

    ROLE_UPDATED("ROLE_UPDATED"),

    USER_AVATAR_UPDATED("USER_AVATAR_UPDATED"),

    USER_CREATED("USER_CREATED"),

    USER_DELETED("USER_DELETED"),

    USER_DEPARTMENTS_UPDATED("USER_DEPARTMENTS_UPDATED"),

    USER_LOCKED("USER_LOCKED"),

    USER_LOGOUT_ALL("USER_LOGOUT_ALL"),

    USER_RESTORED("USER_RESTORED"),

    USER_ROLES_UPDATED("USER_ROLES_UPDATED"),

    USER_SESSIONS_REVOKED("USER_SESSIONS_REVOKED"),

    USER_TWO_FACTOR_RESET("USER_TWO_FACTOR_RESET"),

    USER_UNLOCKED("USER_UNLOCKED"),

    USER_UPDATED("USER_UPDATED");

    private final String value;

    ActionsEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static ActionsEnum fromValue(String value) {
      for (ActionsEnum b : ActionsEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private List<ActionsEnum> actions = new ArrayList<>();

  public AuditActionsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AuditActionsResponseDto(List<ActionsEnum> actions) {
    this.actions = actions;
  }

  public AuditActionsResponseDto actions(List<ActionsEnum> actions) {
    this.actions = actions;
    return this;
  }

  public AuditActionsResponseDto addActionsItem(ActionsEnum actionsItem) {
    if (this.actions == null) {
      this.actions = new ArrayList<>();
    }
    this.actions.add(actionsItem);
    return this;
  }

  /**
   * Get actions
   * @return actions
   */
  @NotNull
  @JsonProperty("actions")
  public List<ActionsEnum> getActions() {
    return actions;
  }

  @JsonProperty("actions")
  public void setActions(List<ActionsEnum> actions) {
    this.actions = actions;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AuditActionsResponseDto auditActionsResponseDto =
      (AuditActionsResponseDto) o;
    return Objects.equals(this.actions, auditActionsResponseDto.actions);
  }

  @Override
  public int hashCode() {
    return Objects.hash(actions);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AuditActionsResponseDto {\n");
    sb.append("    actions: ").append(toIndentedString(actions)).append("\n");
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

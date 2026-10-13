package com.synapsedesk.gateway.modules.roles.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SetRolePermissionsDto
 */

public class SetRolePermissionsDto {

  /**
   * Gets or Sets permissionCodes
   */
  public enum PermissionCodesEnum {
    ANALYTICS_READ("analytics.read"),

    AUDIT_EXPORT("audit.export"),

    AUDIT_READ("audit.read"),

    DEPARTMENT_CREATE("department.create"),

    DEPARTMENT_DELETE("department.delete"),

    DEPARTMENT_MEMBER_ASSIGN("department.member.assign"),

    DEPARTMENT_READ("department.read"),

    DEPARTMENT_UPDATE("department.update"),

    DOCUMENT_CREATE("document.create"),

    DOCUMENT_DELETE("document.delete"),

    DOCUMENT_READ("document.read"),

    DOCUMENT_REINDEX("document.reindex"),

    DOCUMENT_SHARE("document.share"),

    DOCUMENT_UPDATE("document.update"),

    ORGANIZATION_DELETE("organization.delete"),

    ORGANIZATION_READ("organization.read"),

    ORGANIZATION_UPDATE("organization.update"),

    ROLE_CREATE("role.create"),

    ROLE_DELETE("role.delete"),

    ROLE_PERMISSION_ASSIGN("role.permission.assign"),

    ROLE_READ("role.read"),

    ROLE_UPDATE("role.update"),

    TICKET_AI_USE("ticket.ai.use"),

    TICKET_ASSIGN("ticket.assign"),

    TICKET_ASSIGN_SELF("ticket.assign.self"),

    TICKET_CREATE("ticket.create"),

    TICKET_DELETE("ticket.delete"),

    TICKET_ESCALATE("ticket.escalate"),

    TICKET_EXPORT("ticket.export"),

    TICKET_MESSAGE_MODERATE("ticket.message.moderate"),

    TICKET_READ_ALL("ticket.read.all"),

    TICKET_REASSIGN("ticket.reassign"),

    TICKET_RESOLVE("ticket.resolve"),

    TICKET_UPDATE("ticket.update"),

    USER_2FA_RESET("user.2fa.reset"),

    USER_CREATE("user.create"),

    USER_DELETE("user.delete"),

    USER_INVITE("user.invite"),

    USER_LOCK("user.lock"),

    USER_READ("user.read"),

    USER_ROLE_ASSIGN("user.role.assign"),

    USER_SESSION_READ("user.session.read"),

    USER_SESSION_REVOKE("user.session.revoke"),

    USER_UPDATE("user.update");

    private final String value;

    PermissionCodesEnum(String value) {
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
    public static PermissionCodesEnum fromValue(String value) {
      for (PermissionCodesEnum b : PermissionCodesEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private List<PermissionCodesEnum> permissionCodes = new ArrayList<>();

  public SetRolePermissionsDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SetRolePermissionsDto(List<PermissionCodesEnum> permissionCodes) {
    this.permissionCodes = permissionCodes;
  }

  public SetRolePermissionsDto permissionCodes(
    List<PermissionCodesEnum> permissionCodes
  ) {
    this.permissionCodes = permissionCodes;
    return this;
  }

  public SetRolePermissionsDto addPermissionCodesItem(
    PermissionCodesEnum permissionCodesItem
  ) {
    if (this.permissionCodes == null) {
      this.permissionCodes = new ArrayList<>();
    }
    this.permissionCodes.add(permissionCodesItem);
    return this;
  }

  /**
   * Get permissionCodes
   * @return permissionCodes
   */
  @NotNull
  @JsonProperty("permissionCodes")
  public List<PermissionCodesEnum> getPermissionCodes() {
    return permissionCodes;
  }

  @JsonProperty("permissionCodes")
  public void setPermissionCodes(List<PermissionCodesEnum> permissionCodes) {
    this.permissionCodes = permissionCodes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SetRolePermissionsDto setRolePermissionsDto = (SetRolePermissionsDto) o;
    return Objects.equals(
      this.permissionCodes,
      setRolePermissionsDto.permissionCodes
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(permissionCodes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SetRolePermissionsDto {\n");
    sb.append("    permissionCodes: ")
      .append(toIndentedString(permissionCodes))
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

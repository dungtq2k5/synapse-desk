package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * PermissionResponseDto
 */

public class PermissionResponseDto {

  private String id;

  /**
   * Gets or Sets code
   */
  public enum CodeEnum {
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

    CodeEnum(String value) {
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
    public static CodeEnum fromValue(String value) {
      for (CodeEnum b : CodeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private CodeEnum code;

  private String name;

  private String group;

  private Boolean isRetired;

  public PermissionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PermissionResponseDto(
    String id,
    CodeEnum code,
    String name,
    String group,
    Boolean isRetired
  ) {
    this.id = id;
    this.code = code;
    this.name = name;
    this.group = group;
    this.isRetired = isRetired;
  }

  public PermissionResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public PermissionResponseDto code(CodeEnum code) {
    this.code = code;
    return this;
  }

  /**
   * Get code
   * @return code
   */
  @NotNull
  @JsonProperty("code")
  public CodeEnum getCode() {
    return code;
  }

  @JsonProperty("code")
  public void setCode(CodeEnum code) {
    this.code = code;
  }

  public PermissionResponseDto name(String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @NotNull
  @JsonProperty("name")
  public String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(String name) {
    this.name = name;
  }

  public PermissionResponseDto group(String group) {
    this.group = group;
    return this;
  }

  /**
   * The `target` prefix of the code, for grouping in the role editor.
   * @return group
   */
  @NotNull
  @JsonProperty("group")
  public String getGroup() {
    return group;
  }

  @JsonProperty("group")
  public void setGroup(String group) {
    this.group = group;
  }

  public PermissionResponseDto isRetired(Boolean isRetired) {
    this.isRetired = isRetired;
    return this;
  }

  /**
   * True when the code is in the table and no longer in `PERMISSION_CODES`.  Retired rather than deleted, because roles may still hold it (ADR 0038). An editor should show it as ungrantable rather than as an option — the API refuses it either way, and offering it makes the refusal read as a bug.
   * @return isRetired
   */
  @NotNull
  @JsonProperty("isRetired")
  public Boolean getIsRetired() {
    return isRetired;
  }

  @JsonProperty("isRetired")
  public void setIsRetired(Boolean isRetired) {
    this.isRetired = isRetired;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PermissionResponseDto permissionResponseDto = (PermissionResponseDto) o;
    return (
      Objects.equals(this.id, permissionResponseDto.id) &&
      Objects.equals(this.code, permissionResponseDto.code) &&
      Objects.equals(this.name, permissionResponseDto.name) &&
      Objects.equals(this.group, permissionResponseDto.group) &&
      Objects.equals(this.isRetired, permissionResponseDto.isRetired)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, code, name, group, isRetired);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PermissionResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    code: ").append(toIndentedString(code)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    group: ").append(toIndentedString(group)).append("\n");
    sb.append("    isRetired: ")
      .append(toIndentedString(isRetired))
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

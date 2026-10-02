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
 * LockUserDto
 */

public class LockUserDto {

  private String reason;

  private @Nullable String lockedUntil;

  public LockUserDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public LockUserDto(String reason) {
    this.reason = reason;
  }

  public LockUserDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Why the account is being locked. Required — it lands in the audit metadata and in the email to the user.
   * @return reason
   */
  @NotNull
  @Size(min = 1, max = 500)
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  public LockUserDto lockedUntil(@Nullable String lockedUntil) {
    this.lockedUntil = lockedUntil;
    return this;
  }

  /**
   * When the lock should lapse.  **Absent means INDEFINITE**, which is the existing product and the default an admin gets by not thinking about it.  **A PAST date is rejected**, not accepted. The database would take it happily and the account would lock and unlock in the same instant — legal, and incomprehensible to the admin who set it and the user who got the email. Validated here and re-checked in auth-service, because the gateway is not the only possible caller.
   * @return lockedUntil
   */

  @JsonProperty("lockedUntil")
  public @Nullable String getLockedUntil() {
    return lockedUntil;
  }

  @JsonProperty("lockedUntil")
  public void setLockedUntil(@Nullable String lockedUntil) {
    this.lockedUntil = lockedUntil;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    LockUserDto lockUserDto = (LockUserDto) o;
    return (
      Objects.equals(this.reason, lockUserDto.reason) &&
      Objects.equals(this.lockedUntil, lockUserDto.lockedUntil)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(reason, lockedUntil);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LockUserDto {\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    lockedUntil: ")
      .append(toIndentedString(lockedUntil))
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

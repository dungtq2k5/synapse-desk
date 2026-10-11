package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * BackupCodesStatusResponseDto
 */

public class BackupCodesStatusResponseDto {

  private BigDecimal remaining;

  private BigDecimal used;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt = null;

  public BackupCodesStatusResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BackupCodesStatusResponseDto(
    BigDecimal remaining,
    BigDecimal used,
    OffsetDateTime expiresAt
  ) {
    this.remaining = remaining;
    this.used = used;
    this.expiresAt = expiresAt;
  }

  public BackupCodesStatusResponseDto remaining(BigDecimal remaining) {
    this.remaining = remaining;
    return this;
  }

  /**
   * Get remaining
   * @return remaining
   */
  @NotNull
  @Valid
  @JsonProperty("remaining")
  public BigDecimal getRemaining() {
    return remaining;
  }

  @JsonProperty("remaining")
  public void setRemaining(BigDecimal remaining) {
    this.remaining = remaining;
  }

  public BackupCodesStatusResponseDto used(BigDecimal used) {
    this.used = used;
    return this;
  }

  /**
   * Get used
   * @return used
   */
  @NotNull
  @Valid
  @JsonProperty("used")
  public BigDecimal getUsed() {
    return used;
  }

  @JsonProperty("used")
  public void setUsed(BigDecimal used) {
    this.used = used;
  }

  public BackupCodesStatusResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @Valid
  @JsonProperty("expiresAt")
  public OffsetDateTime getExpiresAt() {
    return expiresAt;
  }

  @JsonProperty("expiresAt")
  public void setExpiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BackupCodesStatusResponseDto backupCodesStatusResponseDto =
      (BackupCodesStatusResponseDto) o;
    return (
      Objects.equals(this.remaining, backupCodesStatusResponseDto.remaining) &&
      Objects.equals(this.used, backupCodesStatusResponseDto.used) &&
      Objects.equals(this.expiresAt, backupCodesStatusResponseDto.expiresAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(remaining, used, expiresAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BackupCodesStatusResponseDto {\n");
    sb.append("    remaining: ")
      .append(toIndentedString(remaining))
      .append("\n");
    sb.append("    used: ").append(toIndentedString(used)).append("\n");
    sb.append("    expiresAt: ")
      .append(toIndentedString(expiresAt))
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

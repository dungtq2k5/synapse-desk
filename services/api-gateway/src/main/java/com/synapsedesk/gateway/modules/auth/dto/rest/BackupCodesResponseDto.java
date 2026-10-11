package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
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
 * BackupCodesResponseDto
 */

public class BackupCodesResponseDto {

  private List<String> backupCodes = new ArrayList<>();

  public BackupCodesResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BackupCodesResponseDto(List<String> backupCodes) {
    this.backupCodes = backupCodes;
  }

  public BackupCodesResponseDto backupCodes(List<String> backupCodes) {
    this.backupCodes = backupCodes;
    return this;
  }

  public BackupCodesResponseDto addBackupCodesItem(String backupCodesItem) {
    if (this.backupCodes == null) {
      this.backupCodes = new ArrayList<>();
    }
    this.backupCodes.add(backupCodesItem);
    return this;
  }

  /**
   * Shown once. Only hashes are stored.
   * @return backupCodes
   */
  @NotNull
  @JsonProperty("backupCodes")
  public List<String> getBackupCodes() {
    return backupCodes;
  }

  @JsonProperty("backupCodes")
  public void setBackupCodes(List<String> backupCodes) {
    this.backupCodes = backupCodes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BackupCodesResponseDto backupCodesResponseDto = (BackupCodesResponseDto) o;
    return Objects.equals(this.backupCodes, backupCodesResponseDto.backupCodes);
  }

  @Override
  public int hashCode() {
    return Objects.hash(backupCodes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BackupCodesResponseDto {\n");
    sb.append("    backupCodes: ")
      .append(toIndentedString(backupCodes))
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

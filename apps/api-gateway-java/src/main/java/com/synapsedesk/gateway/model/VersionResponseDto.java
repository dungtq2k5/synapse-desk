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
 * VersionResponseDto
 */

public class VersionResponseDto {

  private String version;

  private String sha;

  private String builtAt;

  public VersionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public VersionResponseDto(String version, String sha, String builtAt) {
    this.version = version;
    this.sha = sha;
    this.builtAt = builtAt;
  }

  public VersionResponseDto version(String version) {
    this.version = version;
    return this;
  }

  /**
   * Get version
   * @return version
   */
  @NotNull
  @JsonProperty("version")
  public String getVersion() {
    return version;
  }

  @JsonProperty("version")
  public void setVersion(String version) {
    this.version = version;
  }

  public VersionResponseDto sha(String sha) {
    this.sha = sha;
    return this;
  }

  /**
   * Get sha
   * @return sha
   */
  @NotNull
  @JsonProperty("sha")
  public String getSha() {
    return sha;
  }

  @JsonProperty("sha")
  public void setSha(String sha) {
    this.sha = sha;
  }

  public VersionResponseDto builtAt(String builtAt) {
    this.builtAt = builtAt;
    return this;
  }

  /**
   * Get builtAt
   * @return builtAt
   */
  @NotNull
  @JsonProperty("builtAt")
  public String getBuiltAt() {
    return builtAt;
  }

  @JsonProperty("builtAt")
  public void setBuiltAt(String builtAt) {
    this.builtAt = builtAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    VersionResponseDto versionResponseDto = (VersionResponseDto) o;
    return (
      Objects.equals(this.version, versionResponseDto.version) &&
      Objects.equals(this.sha, versionResponseDto.sha) &&
      Objects.equals(this.builtAt, versionResponseDto.builtAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(version, sha, builtAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class VersionResponseDto {\n");
    sb.append("    version: ").append(toIndentedString(version)).append("\n");
    sb.append("    sha: ").append(toIndentedString(sha)).append("\n");
    sb.append("    builtAt: ").append(toIndentedString(builtAt)).append("\n");
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

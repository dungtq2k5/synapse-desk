package com.synapsedesk.gateway.modules.documents.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * DownloadDocumentResponseDto
 */

public class DownloadDocumentResponseDto {

  private String downloadUrl;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt;

  public DownloadDocumentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DownloadDocumentResponseDto(
    String downloadUrl,
    OffsetDateTime expiresAt
  ) {
    this.downloadUrl = downloadUrl;
    this.expiresAt = expiresAt;
  }

  public DownloadDocumentResponseDto downloadUrl(String downloadUrl) {
    this.downloadUrl = downloadUrl;
    return this;
  }

  /**
   * Get downloadUrl
   * @return downloadUrl
   */
  @NotNull
  @JsonProperty("downloadUrl")
  public String getDownloadUrl() {
    return downloadUrl;
  }

  @JsonProperty("downloadUrl")
  public void setDownloadUrl(String downloadUrl) {
    this.downloadUrl = downloadUrl;
  }

  public DownloadDocumentResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @NotNull
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
    DownloadDocumentResponseDto downloadDocumentResponseDto =
      (DownloadDocumentResponseDto) o;
    return (
      Objects.equals(
        this.downloadUrl,
        downloadDocumentResponseDto.downloadUrl
      ) && Objects.equals(this.expiresAt, downloadDocumentResponseDto.expiresAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(downloadUrl, expiresAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DownloadDocumentResponseDto {\n");
    sb.append("    downloadUrl: ")
      .append(toIndentedString(downloadUrl))
      .append("\n");
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

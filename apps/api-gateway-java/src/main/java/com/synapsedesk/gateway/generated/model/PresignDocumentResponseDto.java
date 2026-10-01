package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * PresignDocumentResponseDto
 */

public class PresignDocumentResponseDto {

  private String uploadUrl;

  private String objectPath;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt;

  public PresignDocumentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PresignDocumentResponseDto(String uploadUrl, String objectPath, OffsetDateTime expiresAt) {
    this.uploadUrl = uploadUrl;
    this.objectPath = objectPath;
    this.expiresAt = expiresAt;
  }

  public PresignDocumentResponseDto uploadUrl(String uploadUrl) {
    this.uploadUrl = uploadUrl;
    return this;
  }

  /**
   * Get uploadUrl
   * @return uploadUrl
   */
  @NotNull 
  @JsonProperty("uploadUrl")
  public String getUploadUrl() {
    return uploadUrl;
  }

  @JsonProperty("uploadUrl")
  public void setUploadUrl(String uploadUrl) {
    this.uploadUrl = uploadUrl;
  }

  public PresignDocumentResponseDto objectPath(String objectPath) {
    this.objectPath = objectPath;
    return this;
  }

  /**
   * Get objectPath
   * @return objectPath
   */
  @NotNull 
  @JsonProperty("objectPath")
  public String getObjectPath() {
    return objectPath;
  }

  @JsonProperty("objectPath")
  public void setObjectPath(String objectPath) {
    this.objectPath = objectPath;
  }

  public PresignDocumentResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @NotNull @Valid 
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
    PresignDocumentResponseDto presignDocumentResponseDto = (PresignDocumentResponseDto) o;
    return Objects.equals(this.uploadUrl, presignDocumentResponseDto.uploadUrl) &&
        Objects.equals(this.objectPath, presignDocumentResponseDto.objectPath) &&
        Objects.equals(this.expiresAt, presignDocumentResponseDto.expiresAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(uploadUrl, objectPath, expiresAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PresignDocumentResponseDto {\n");
    sb.append("    uploadUrl: ").append(toIndentedString(uploadUrl)).append("\n");
    sb.append("    objectPath: ").append(toIndentedString(objectPath)).append("\n");
    sb.append("    expiresAt: ").append(toIndentedString(expiresAt)).append("\n");
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


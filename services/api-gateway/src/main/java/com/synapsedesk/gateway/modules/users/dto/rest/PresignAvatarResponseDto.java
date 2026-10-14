package com.synapsedesk.gateway.modules.users.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.dto.UploadMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * PresignAvatarResponseDto
 */

public class PresignAvatarResponseDto {

  private String uploadUrl;

  private UploadMethod uploadMethod;

  private String objectPath;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt;

  public PresignAvatarResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PresignAvatarResponseDto(
    String uploadUrl,
    UploadMethod uploadMethod,
    String objectPath,
    OffsetDateTime expiresAt
  ) {
    this.uploadUrl = uploadUrl;
    this.uploadMethod = uploadMethod;
    this.objectPath = objectPath;
    this.expiresAt = expiresAt;
  }

  public PresignAvatarResponseDto uploadUrl(String uploadUrl) {
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

  public PresignAvatarResponseDto uploadMethod(UploadMethod uploadMethod) {
    this.uploadMethod = uploadMethod;
    return this;
  }

  /**
   * How to send the bytes to `uploadUrl`, with the declared `Content-Type`: `PUT` to a signed URL, or `POST` to the local Storage emulator.
   * @return uploadMethod
   */
  @NotNull
  @JsonProperty("uploadMethod")
  public UploadMethod getUploadMethod() {
    return uploadMethod;
  }

  @JsonProperty("uploadMethod")
  public void setUploadMethod(UploadMethod uploadMethod) {
    this.uploadMethod = uploadMethod;
  }

  public PresignAvatarResponseDto objectPath(String objectPath) {
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

  public PresignAvatarResponseDto expiresAt(OffsetDateTime expiresAt) {
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
    PresignAvatarResponseDto presignAvatarResponseDto =
      (PresignAvatarResponseDto) o;
    return (
      Objects.equals(this.uploadUrl, presignAvatarResponseDto.uploadUrl) &&
      Objects.equals(
        this.uploadMethod,
        presignAvatarResponseDto.uploadMethod
      ) &&
      Objects.equals(this.objectPath, presignAvatarResponseDto.objectPath) &&
      Objects.equals(this.expiresAt, presignAvatarResponseDto.expiresAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(uploadUrl, uploadMethod, objectPath, expiresAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PresignAvatarResponseDto {\n");
    sb.append("    uploadUrl: ")
      .append(toIndentedString(uploadUrl))
      .append("\n");
    sb.append("    uploadMethod: ")
      .append(toIndentedString(uploadMethod))
      .append("\n");
    sb.append("    objectPath: ")
      .append(toIndentedString(objectPath))
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

package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * ConfirmAttachmentDto
 */

public class ConfirmAttachmentDto {

  private String objectPath;

  private String fileName;

  public ConfirmAttachmentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ConfirmAttachmentDto(String objectPath, String fileName) {
    this.objectPath = objectPath;
    this.fileName = fileName;
  }

  public ConfirmAttachmentDto objectPath(String objectPath) {
    this.objectPath = objectPath;
    return this;
  }

  /**
   * Echoed back from the presign response.  Not shape-validated here on purpose: ticket-service passes it to storage-service, which checks it against the PendingUpload it recorded — a real authorization check rather than a syntactic one. A regex here would only reject well-formed paths that were never authorized, which is exactly the case the real check catches better.
   * @return objectPath
   */
  @NotNull @Size(min = 1, max = 1024) 
  @JsonProperty("objectPath")
  public String getObjectPath() {
    return objectPath;
  }

  @JsonProperty("objectPath")
  public void setObjectPath(String objectPath) {
    this.objectPath = objectPath;
  }

  public ConfirmAttachmentDto fileName(String fileName) {
    this.fileName = fileName;
    return this;
  }

  /**
   * Get fileName
   * @return fileName
   */
  @NotNull @Size(min = 1, max = 255) 
  @JsonProperty("fileName")
  public String getFileName() {
    return fileName;
  }

  @JsonProperty("fileName")
  public void setFileName(String fileName) {
    this.fileName = fileName;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ConfirmAttachmentDto confirmAttachmentDto = (ConfirmAttachmentDto) o;
    return Objects.equals(this.objectPath, confirmAttachmentDto.objectPath) &&
        Objects.equals(this.fileName, confirmAttachmentDto.fileName);
  }

  @Override
  public int hashCode() {
    return Objects.hash(objectPath, fileName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ConfirmAttachmentDto {\n");
    sb.append("    objectPath: ").append(toIndentedString(objectPath)).append("\n");
    sb.append("    fileName: ").append(toIndentedString(fileName)).append("\n");
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


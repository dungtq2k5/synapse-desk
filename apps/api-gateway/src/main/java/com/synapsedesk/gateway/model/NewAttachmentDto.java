package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * NewAttachmentDto
 */

public class NewAttachmentDto {

  private String objectPath;

  private String fileName;

  public NewAttachmentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public NewAttachmentDto(String objectPath, String fileName) {
    this.objectPath = objectPath;
    this.fileName = fileName;
  }

  public NewAttachmentDto objectPath(String objectPath) {
    this.objectPath = objectPath;
    return this;
  }

  /**
   * Get objectPath
   * @return objectPath
   */
  @NotNull
  @Size(min = 1, max = 1024)
  @JsonProperty("objectPath")
  public String getObjectPath() {
    return objectPath;
  }

  @JsonProperty("objectPath")
  public void setObjectPath(String objectPath) {
    this.objectPath = objectPath;
  }

  public NewAttachmentDto fileName(String fileName) {
    this.fileName = fileName;
    return this;
  }

  /**
   * Get fileName
   * @return fileName
   */
  @NotNull
  @Size(min = 1, max = 255)
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
    NewAttachmentDto newAttachmentDto = (NewAttachmentDto) o;
    return (
      Objects.equals(this.objectPath, newAttachmentDto.objectPath) &&
      Objects.equals(this.fileName, newAttachmentDto.fileName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(objectPath, fileName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class NewAttachmentDto {\n");
    sb.append("    objectPath: ")
      .append(toIndentedString(objectPath))
      .append("\n");
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

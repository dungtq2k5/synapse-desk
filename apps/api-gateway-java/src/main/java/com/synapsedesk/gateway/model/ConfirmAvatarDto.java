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
 * ConfirmAvatarDto
 */

public class ConfirmAvatarDto {

  private String objectPath;

  public ConfirmAvatarDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ConfirmAvatarDto(String objectPath) {
    this.objectPath = objectPath;
  }

  public ConfirmAvatarDto objectPath(String objectPath) {
    this.objectPath = objectPath;
    return this;
  }

  /**
   * The path the presign step returned, echoed back.  Not validated as a URL or a shape here, on purpose: storage-service checks it against the PendingUpload it recorded, which is a real authorization check rather than a syntactic one. A regex here would only reject well-formed paths that were never authorized — the exact case the real check catches better.
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ConfirmAvatarDto confirmAvatarDto = (ConfirmAvatarDto) o;
    return Objects.equals(this.objectPath, confirmAvatarDto.objectPath);
  }

  @Override
  public int hashCode() {
    return Objects.hash(objectPath);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ConfirmAvatarDto {\n");
    sb.append("    objectPath: ")
      .append(toIndentedString(objectPath))
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

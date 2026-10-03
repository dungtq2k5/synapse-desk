package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * PresignAvatarDto
 */

public class PresignAvatarDto {

  /**
   * No SVG. An SVG is a document that can carry script — the one image type that behaves like an executable when served.
   */
  public enum ContentTypeEnum {
    IMAGE_JPEG("image/jpeg"),

    IMAGE_PNG("image/png"),

    IMAGE_WEBP("image/webp");

    private final String value;

    ContentTypeEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static ContentTypeEnum fromValue(String value) {
      for (ContentTypeEnum b : ContentTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private ContentTypeEnum contentType;

  private BigDecimal sizeBytes;

  private String fileName;

  public PresignAvatarDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PresignAvatarDto(
    ContentTypeEnum contentType,
    BigDecimal sizeBytes,
    String fileName
  ) {
    this.contentType = contentType;
    this.sizeBytes = sizeBytes;
    this.fileName = fileName;
  }

  public PresignAvatarDto contentType(ContentTypeEnum contentType) {
    this.contentType = contentType;
    return this;
  }

  /**
   * No SVG. An SVG is a document that can carry script — the one image type that behaves like an executable when served.
   * @return contentType
   */
  @NotNull
  @JsonProperty("contentType")
  public ContentTypeEnum getContentType() {
    return contentType;
  }

  @JsonProperty("contentType")
  public void setContentType(ContentTypeEnum contentType) {
    this.contentType = contentType;
  }

  public PresignAvatarDto sizeBytes(BigDecimal sizeBytes) {
    this.sizeBytes = sizeBytes;
    return this;
  }

  /**
   * Get sizeBytes
   * minimum: 1
   * maximum: 2097152
   * @return sizeBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "2097152")
  @JsonProperty("sizeBytes")
  public BigDecimal getSizeBytes() {
    return sizeBytes;
  }

  @JsonProperty("sizeBytes")
  public void setSizeBytes(BigDecimal sizeBytes) {
    this.sizeBytes = sizeBytes;
  }

  public PresignAvatarDto fileName(String fileName) {
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
    PresignAvatarDto presignAvatarDto = (PresignAvatarDto) o;
    return (
      Objects.equals(this.contentType, presignAvatarDto.contentType) &&
      Objects.equals(this.sizeBytes, presignAvatarDto.sizeBytes) &&
      Objects.equals(this.fileName, presignAvatarDto.fileName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(contentType, sizeBytes, fileName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PresignAvatarDto {\n");
    sb.append("    contentType: ")
      .append(toIndentedString(contentType))
      .append("\n");
    sb.append("    sizeBytes: ")
      .append(toIndentedString(sizeBytes))
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

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
import org.springframework.lang.Nullable;

/**
 * PresignDocumentDto
 */

public class PresignDocumentDto {

  /**
   * The document's MIME type. Must be one the parser accepts.
   */
  public enum ContentTypeEnum {
    APPLICATION_PDF("application/pdf"),

    APPLICATION_VND_OPENXMLFORMATS_OFFICEDOCUMENT_WORDPROCESSINGML_DOCUMENT(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),

    TEXT_MARKDOWN("text/markdown"),

    TEXT_PLAIN("text/plain");

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

  public PresignDocumentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PresignDocumentDto(
    ContentTypeEnum contentType,
    BigDecimal sizeBytes,
    String fileName
  ) {
    this.contentType = contentType;
    this.sizeBytes = sizeBytes;
    this.fileName = fileName;
  }

  public PresignDocumentDto contentType(ContentTypeEnum contentType) {
    this.contentType = contentType;
    return this;
  }

  /**
   * The document's MIME type. Must be one the parser accepts.
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

  public PresignDocumentDto sizeBytes(BigDecimal sizeBytes) {
    this.sizeBytes = sizeBytes;
    return this;
  }

  /**
   * Get sizeBytes
   * minimum: 1
   * maximum: 104857600
   * @return sizeBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "104857600")
  @JsonProperty("sizeBytes")
  public BigDecimal getSizeBytes() {
    return sizeBytes;
  }

  @JsonProperty("sizeBytes")
  public void setSizeBytes(BigDecimal sizeBytes) {
    this.sizeBytes = sizeBytes;
  }

  public PresignDocumentDto fileName(String fileName) {
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
    PresignDocumentDto presignDocumentDto = (PresignDocumentDto) o;
    return (
      Objects.equals(this.contentType, presignDocumentDto.contentType) &&
      Objects.equals(this.sizeBytes, presignDocumentDto.sizeBytes) &&
      Objects.equals(this.fileName, presignDocumentDto.fileName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(contentType, sizeBytes, fileName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PresignDocumentDto {\n");
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

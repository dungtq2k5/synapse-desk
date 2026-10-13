package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UploadAttachmentDto
 */

public class UploadAttachmentDto {

  private String fileName;

  /**
   * An allowlist, never a denylist. A denylist is a promise to have thought of every dangerous type, which is not a promise anyone can keep.
   */
  public enum MimeTypeEnum {
    APPLICATION_MSWORD("application/msword"),

    APPLICATION_PDF("application/pdf"),

    APPLICATION_VND_OPENXMLFORMATS_OFFICEDOCUMENT_SPREADSHEETML_SHEET(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),

    APPLICATION_VND_OPENXMLFORMATS_OFFICEDOCUMENT_WORDPROCESSINGML_DOCUMENT(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),

    IMAGE_HEIC("image/heic"),

    IMAGE_HEIF("image/heif"),

    IMAGE_JPEG("image/jpeg"),

    IMAGE_PNG("image/png"),

    IMAGE_WEBP("image/webp"),

    TEXT_CSV("text/csv"),

    TEXT_MARKDOWN("text/markdown"),

    TEXT_PLAIN("text/plain");

    private final String value;

    MimeTypeEnum(String value) {
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
    public static MimeTypeEnum fromValue(String value) {
      for (MimeTypeEnum b : MimeTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private MimeTypeEnum mimeType;

  private BigDecimal fileSizeBytes;

  public UploadAttachmentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UploadAttachmentDto(
    String fileName,
    MimeTypeEnum mimeType,
    BigDecimal fileSizeBytes
  ) {
    this.fileName = fileName;
    this.mimeType = mimeType;
    this.fileSizeBytes = fileSizeBytes;
  }

  public UploadAttachmentDto fileName(String fileName) {
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

  public UploadAttachmentDto mimeType(MimeTypeEnum mimeType) {
    this.mimeType = mimeType;
    return this;
  }

  /**
   * An allowlist, never a denylist. A denylist is a promise to have thought of every dangerous type, which is not a promise anyone can keep.
   * @return mimeType
   */
  @NotNull
  @JsonProperty("mimeType")
  public MimeTypeEnum getMimeType() {
    return mimeType;
  }

  @JsonProperty("mimeType")
  public void setMimeType(MimeTypeEnum mimeType) {
    this.mimeType = mimeType;
  }

  public UploadAttachmentDto fileSizeBytes(BigDecimal fileSizeBytes) {
    this.fileSizeBytes = fileSizeBytes;
    return this;
  }

  /**
   * Declared by the client and therefore not trustworthy on its own — the real enforcement is the signed URL's own size constraint. Checking it here still earns its place: it turns \"upload 2 GB, then be refused\" into an immediate refusal, and it documents the cap in the API contract.
   * minimum: 1
   * maximum: 10485760
   * @return fileSizeBytes
   */
  @NotNull
  @Valid
  @DecimalMin(value = "1")
  @DecimalMax(value = "10485760")
  @JsonProperty("fileSizeBytes")
  public BigDecimal getFileSizeBytes() {
    return fileSizeBytes;
  }

  @JsonProperty("fileSizeBytes")
  public void setFileSizeBytes(BigDecimal fileSizeBytes) {
    this.fileSizeBytes = fileSizeBytes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UploadAttachmentDto uploadAttachmentDto = (UploadAttachmentDto) o;
    return (
      Objects.equals(this.fileName, uploadAttachmentDto.fileName) &&
      Objects.equals(this.mimeType, uploadAttachmentDto.mimeType) &&
      Objects.equals(this.fileSizeBytes, uploadAttachmentDto.fileSizeBytes)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(fileName, mimeType, fileSizeBytes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UploadAttachmentDto {\n");
    sb.append("    fileName: ").append(toIndentedString(fileName)).append("\n");
    sb.append("    mimeType: ").append(toIndentedString(mimeType)).append("\n");
    sb.append("    fileSizeBytes: ")
      .append(toIndentedString(fileSizeBytes))
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

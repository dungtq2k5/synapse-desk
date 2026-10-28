package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * AttachmentResponseDto
 */

public class AttachmentResponseDto {

  private String id;

  private String messageId = null;

  private String ticketId;

  private String fileName;

  private String fileUrl;

  private BigDecimal fileSizeBytes;

  private String mimeType;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public AttachmentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AttachmentResponseDto(
    String id,
    String messageId,
    String ticketId,
    String fileName,
    String fileUrl,
    BigDecimal fileSizeBytes,
    String mimeType,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.messageId = messageId;
    this.ticketId = ticketId;
    this.fileName = fileName;
    this.fileUrl = fileUrl;
    this.fileSizeBytes = fileSizeBytes;
    this.mimeType = mimeType;
    this.createdAt = createdAt;
  }

  public AttachmentResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public AttachmentResponseDto messageId(String messageId) {
    this.messageId = messageId;
    return this;
  }

  /**
   * Null for a file on the ticket's opening, which has no message.
   * @return messageId
   */
  @JsonProperty("messageId")
  public String getMessageId() {
    return messageId;
  }

  @JsonProperty("messageId")
  public void setMessageId(String messageId) {
    this.messageId = messageId;
  }

  public AttachmentResponseDto ticketId(String ticketId) {
    this.ticketId = ticketId;
    return this;
  }

  /**
   * The ticket the file belongs to, through its message or directly.
   * @return ticketId
   */
  @NotNull
  @JsonProperty("ticketId")
  public String getTicketId() {
    return ticketId;
  }

  @JsonProperty("ticketId")
  public void setTicketId(String ticketId) {
    this.ticketId = ticketId;
  }

  public AttachmentResponseDto fileName(String fileName) {
    this.fileName = fileName;
    return this;
  }

  /**
   * Get fileName
   * @return fileName
   */
  @NotNull
  @JsonProperty("fileName")
  public String getFileName() {
    return fileName;
  }

  @JsonProperty("fileName")
  public void setFileName(String fileName) {
    this.fileName = fileName;
  }

  public AttachmentResponseDto fileUrl(String fileUrl) {
    this.fileUrl = fileUrl;
    return this;
  }

  /**
   * An internal object path today; a signed URL once storage-service lands.
   * @return fileUrl
   */
  @NotNull
  @JsonProperty("fileUrl")
  public String getFileUrl() {
    return fileUrl;
  }

  @JsonProperty("fileUrl")
  public void setFileUrl(String fileUrl) {
    this.fileUrl = fileUrl;
  }

  public AttachmentResponseDto fileSizeBytes(BigDecimal fileSizeBytes) {
    this.fileSizeBytes = fileSizeBytes;
    return this;
  }

  /**
   * Get fileSizeBytes
   * @return fileSizeBytes
   */
  @NotNull
  @Valid
  @JsonProperty("fileSizeBytes")
  public BigDecimal getFileSizeBytes() {
    return fileSizeBytes;
  }

  @JsonProperty("fileSizeBytes")
  public void setFileSizeBytes(BigDecimal fileSizeBytes) {
    this.fileSizeBytes = fileSizeBytes;
  }

  public AttachmentResponseDto mimeType(String mimeType) {
    this.mimeType = mimeType;
    return this;
  }

  /**
   * Get mimeType
   * @return mimeType
   */
  @NotNull
  @JsonProperty("mimeType")
  public String getMimeType() {
    return mimeType;
  }

  @JsonProperty("mimeType")
  public void setMimeType(String mimeType) {
    this.mimeType = mimeType;
  }

  public AttachmentResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AttachmentResponseDto attachmentResponseDto = (AttachmentResponseDto) o;
    return (
      Objects.equals(this.id, attachmentResponseDto.id) &&
      Objects.equals(this.messageId, attachmentResponseDto.messageId) &&
      Objects.equals(this.ticketId, attachmentResponseDto.ticketId) &&
      Objects.equals(this.fileName, attachmentResponseDto.fileName) &&
      Objects.equals(this.fileUrl, attachmentResponseDto.fileUrl) &&
      Objects.equals(this.fileSizeBytes, attachmentResponseDto.fileSizeBytes) &&
      Objects.equals(this.mimeType, attachmentResponseDto.mimeType) &&
      Objects.equals(this.createdAt, attachmentResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      messageId,
      ticketId,
      fileName,
      fileUrl,
      fileSizeBytes,
      mimeType,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AttachmentResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    messageId: ")
      .append(toIndentedString(messageId))
      .append("\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    fileName: ").append(toIndentedString(fileName)).append("\n");
    sb.append("    fileUrl: ").append(toIndentedString(fileUrl)).append("\n");
    sb.append("    fileSizeBytes: ")
      .append(toIndentedString(fileSizeBytes))
      .append("\n");
    sb.append("    mimeType: ").append(toIndentedString(mimeType)).append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
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

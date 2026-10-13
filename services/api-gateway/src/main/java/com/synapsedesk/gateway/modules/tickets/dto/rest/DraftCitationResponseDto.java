package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * DraftCitationResponseDto
 */

public class DraftCitationResponseDto {

  private String chunkId;

  private String documentId;

  private String documentTitle;

  private BigDecimal pageNumber = null;

  public DraftCitationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DraftCitationResponseDto(
    String chunkId,
    String documentId,
    String documentTitle,
    BigDecimal pageNumber
  ) {
    this.chunkId = chunkId;
    this.documentId = documentId;
    this.documentTitle = documentTitle;
    this.pageNumber = pageNumber;
  }

  public DraftCitationResponseDto chunkId(String chunkId) {
    this.chunkId = chunkId;
    return this;
  }

  /**
   * Get chunkId
   * @return chunkId
   */
  @NotNull
  @JsonProperty("chunkId")
  public String getChunkId() {
    return chunkId;
  }

  @JsonProperty("chunkId")
  public void setChunkId(String chunkId) {
    this.chunkId = chunkId;
  }

  public DraftCitationResponseDto documentId(String documentId) {
    this.documentId = documentId;
    return this;
  }

  /**
   * Get documentId
   * @return documentId
   */
  @NotNull
  @JsonProperty("documentId")
  public String getDocumentId() {
    return documentId;
  }

  @JsonProperty("documentId")
  public void setDocumentId(String documentId) {
    this.documentId = documentId;
  }

  public DraftCitationResponseDto documentTitle(String documentTitle) {
    this.documentTitle = documentTitle;
    return this;
  }

  /**
   * Get documentTitle
   * @return documentTitle
   */
  @NotNull
  @JsonProperty("documentTitle")
  public String getDocumentTitle() {
    return documentTitle;
  }

  @JsonProperty("documentTitle")
  public void setDocumentTitle(String documentTitle) {
    this.documentTitle = documentTitle;
  }

  public DraftCitationResponseDto pageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
    return this;
  }

  /**
   * The page this citation points at, or `null` when the source document has no pages — a pasted text file, an HTML article. Never faked as 1.
   * @return pageNumber
   */
  @Valid
  @JsonProperty("pageNumber")
  public BigDecimal getPageNumber() {
    return pageNumber;
  }

  @JsonProperty("pageNumber")
  public void setPageNumber(BigDecimal pageNumber) {
    this.pageNumber = pageNumber;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DraftCitationResponseDto draftCitationResponseDto =
      (DraftCitationResponseDto) o;
    return (
      Objects.equals(this.chunkId, draftCitationResponseDto.chunkId) &&
      Objects.equals(this.documentId, draftCitationResponseDto.documentId) &&
      Objects.equals(
        this.documentTitle,
        draftCitationResponseDto.documentTitle
      ) &&
      Objects.equals(this.pageNumber, draftCitationResponseDto.pageNumber)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(chunkId, documentId, documentTitle, pageNumber);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DraftCitationResponseDto {\n");
    sb.append("    chunkId: ").append(toIndentedString(chunkId)).append("\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    documentTitle: ")
      .append(toIndentedString(documentTitle))
      .append("\n");
    sb.append("    pageNumber: ")
      .append(toIndentedString(pageNumber))
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

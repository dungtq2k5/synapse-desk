package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * DocumentFlagResponseDto
 */

public class DocumentFlagResponseDto {

  private String id;

  private String documentId;

  private String documentTitle;

  /**
   * What kind of attention this document needs, or `null` when the value is one this build does not recognise — the same nullability {@link DocumentResponseDto.status} carries, and for the same reason.
   */
  public enum FlagTypeEnum {
    CONFLICTING("CONFLICTING"),

    LOW_CONFIDENCE("LOW_CONFIDENCE"),

    NEGATIVE_FEEDBACK("NEGATIVE_FEEDBACK"),

    OUTDATED("OUTDATED"),

    PAGES_NOT_INDEXED("PAGES_NOT_INDEXED"),

    UNCITED("UNCITED"),

    UNRETRIEVED("UNRETRIEVED");

    private final String value;

    FlagTypeEnum(String value) {
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
    public static FlagTypeEnum fromValue(String value) {
      for (FlagTypeEnum b : FlagTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private FlagTypeEnum flagType = null;

  /**
   * Gets or Sets severity
   */
  public enum SeverityEnum {
    CRITICAL("CRITICAL"),

    INFO("INFO"),

    WARNING("WARNING");

    private final String value;

    SeverityEnum(String value) {
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
    public static SeverityEnum fromValue(String value) {
      for (SeverityEnum b : SeverityEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private SeverityEnum severity = null;

  private String detail;

  private BigDecimal confidenceScore = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime detectedAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime resolvedAt = null;

  private String resolvedById = null;

  /**
   * `null` while the flag is open, which is what an open flag sends.
   */
  public enum ResolutionEnum {
    DISMISSED("DISMISSED"),

    DOCUMENT_REPLACED("DOCUMENT_REPLACED"),

    FIXED("FIXED");

    private final String value;

    ResolutionEnum(String value) {
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
    public static ResolutionEnum fromValue(String value) {
      for (ResolutionEnum b : ResolutionEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private ResolutionEnum resolution = null;

  private String resolutionComment = null;

  private String relatedDocumentId = null;

  private String relatedChunkId = null;

  public DocumentFlagResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentFlagResponseDto(
    String id,
    String documentId,
    String documentTitle,
    FlagTypeEnum flagType,
    SeverityEnum severity,
    String detail,
    BigDecimal confidenceScore,
    OffsetDateTime detectedAt,
    OffsetDateTime resolvedAt,
    String resolvedById,
    ResolutionEnum resolution,
    String resolutionComment,
    String relatedDocumentId,
    String relatedChunkId
  ) {
    this.id = id;
    this.documentId = documentId;
    this.documentTitle = documentTitle;
    this.flagType = flagType;
    this.severity = severity;
    this.detail = detail;
    this.confidenceScore = confidenceScore;
    this.detectedAt = detectedAt;
    this.resolvedAt = resolvedAt;
    this.resolvedById = resolvedById;
    this.resolution = resolution;
    this.resolutionComment = resolutionComment;
    this.relatedDocumentId = relatedDocumentId;
    this.relatedChunkId = relatedChunkId;
  }

  public DocumentFlagResponseDto id(String id) {
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

  public DocumentFlagResponseDto documentId(String documentId) {
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

  public DocumentFlagResponseDto documentTitle(String documentTitle) {
    this.documentTitle = documentTitle;
    return this;
  }

  /**
   * The flagged document's title, joined in so the list reads as a worklist.
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

  public DocumentFlagResponseDto flagType(FlagTypeEnum flagType) {
    this.flagType = flagType;
    return this;
  }

  /**
   * What kind of attention this document needs, or `null` when the value is one this build does not recognise — the same nullability {@link DocumentResponseDto.status} carries, and for the same reason.
   * @return flagType
   */

  @JsonProperty("flagType")
  public FlagTypeEnum getFlagType() {
    return flagType;
  }

  @JsonProperty("flagType")
  public void setFlagType(FlagTypeEnum flagType) {
    this.flagType = flagType;
  }

  public DocumentFlagResponseDto severity(SeverityEnum severity) {
    this.severity = severity;
    return this;
  }

  /**
   * Get severity
   * @return severity
   */

  @JsonProperty("severity")
  public SeverityEnum getSeverity() {
    return severity;
  }

  @JsonProperty("severity")
  public void setSeverity(SeverityEnum severity) {
    this.severity = severity;
  }

  public DocumentFlagResponseDto detail(String detail) {
    this.detail = detail;
    return this;
  }

  /**
   * Get detail
   * @return detail
   */
  @NotNull
  @JsonProperty("detail")
  public String getDetail() {
    return detail;
  }

  @JsonProperty("detail")
  public void setDetail(String detail) {
    this.detail = detail;
  }

  public DocumentFlagResponseDto confidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
    return this;
  }

  /**
   * Get confidenceScore
   * @return confidenceScore
   */
  @Valid
  @JsonProperty("confidenceScore")
  public BigDecimal getConfidenceScore() {
    return confidenceScore;
  }

  @JsonProperty("confidenceScore")
  public void setConfidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
  }

  public DocumentFlagResponseDto detectedAt(OffsetDateTime detectedAt) {
    this.detectedAt = detectedAt;
    return this;
  }

  /**
   * Get detectedAt
   * @return detectedAt
   */
  @NotNull
  @Valid
  @JsonProperty("detectedAt")
  public OffsetDateTime getDetectedAt() {
    return detectedAt;
  }

  @JsonProperty("detectedAt")
  public void setDetectedAt(OffsetDateTime detectedAt) {
    this.detectedAt = detectedAt;
  }

  public DocumentFlagResponseDto resolvedAt(OffsetDateTime resolvedAt) {
    this.resolvedAt = resolvedAt;
    return this;
  }

  /**
   * `null` while the flag is open.
   * @return resolvedAt
   */
  @Valid
  @JsonProperty("resolvedAt")
  public OffsetDateTime getResolvedAt() {
    return resolvedAt;
  }

  @JsonProperty("resolvedAt")
  public void setResolvedAt(OffsetDateTime resolvedAt) {
    this.resolvedAt = resolvedAt;
  }

  public DocumentFlagResponseDto resolvedById(String resolvedById) {
    this.resolvedById = resolvedById;
    return this;
  }

  /**
   * A bare id — the gateway does not hydrate it into a user.
   * @return resolvedById
   */

  @JsonProperty("resolvedById")
  public String getResolvedById() {
    return resolvedById;
  }

  @JsonProperty("resolvedById")
  public void setResolvedById(String resolvedById) {
    this.resolvedById = resolvedById;
  }

  public DocumentFlagResponseDto resolution(ResolutionEnum resolution) {
    this.resolution = resolution;
    return this;
  }

  /**
   * `null` while the flag is open, which is what an open flag sends.
   * @return resolution
   */

  @JsonProperty("resolution")
  public ResolutionEnum getResolution() {
    return resolution;
  }

  @JsonProperty("resolution")
  public void setResolution(ResolutionEnum resolution) {
    this.resolution = resolution;
  }

  public DocumentFlagResponseDto resolutionComment(String resolutionComment) {
    this.resolutionComment = resolutionComment;
    return this;
  }

  /**
   * Get resolutionComment
   * @return resolutionComment
   */

  @JsonProperty("resolutionComment")
  public String getResolutionComment() {
    return resolutionComment;
  }

  @JsonProperty("resolutionComment")
  public void setResolutionComment(String resolutionComment) {
    this.resolutionComment = resolutionComment;
  }

  public DocumentFlagResponseDto relatedDocumentId(String relatedDocumentId) {
    this.relatedDocumentId = relatedDocumentId;
    return this;
  }

  /**
   * Get relatedDocumentId
   * @return relatedDocumentId
   */

  @JsonProperty("relatedDocumentId")
  public String getRelatedDocumentId() {
    return relatedDocumentId;
  }

  @JsonProperty("relatedDocumentId")
  public void setRelatedDocumentId(String relatedDocumentId) {
    this.relatedDocumentId = relatedDocumentId;
  }

  public DocumentFlagResponseDto relatedChunkId(String relatedChunkId) {
    this.relatedChunkId = relatedChunkId;
    return this;
  }

  /**
   * Get relatedChunkId
   * @return relatedChunkId
   */

  @JsonProperty("relatedChunkId")
  public String getRelatedChunkId() {
    return relatedChunkId;
  }

  @JsonProperty("relatedChunkId")
  public void setRelatedChunkId(String relatedChunkId) {
    this.relatedChunkId = relatedChunkId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentFlagResponseDto documentFlagResponseDto =
      (DocumentFlagResponseDto) o;
    return (
      Objects.equals(this.id, documentFlagResponseDto.id) &&
      Objects.equals(this.documentId, documentFlagResponseDto.documentId) &&
      Objects.equals(
        this.documentTitle,
        documentFlagResponseDto.documentTitle
      ) &&
      Objects.equals(this.flagType, documentFlagResponseDto.flagType) &&
      Objects.equals(this.severity, documentFlagResponseDto.severity) &&
      Objects.equals(this.detail, documentFlagResponseDto.detail) &&
      Objects.equals(
        this.confidenceScore,
        documentFlagResponseDto.confidenceScore
      ) &&
      Objects.equals(this.detectedAt, documentFlagResponseDto.detectedAt) &&
      Objects.equals(this.resolvedAt, documentFlagResponseDto.resolvedAt) &&
      Objects.equals(this.resolvedById, documentFlagResponseDto.resolvedById) &&
      Objects.equals(this.resolution, documentFlagResponseDto.resolution) &&
      Objects.equals(
        this.resolutionComment,
        documentFlagResponseDto.resolutionComment
      ) &&
      Objects.equals(
        this.relatedDocumentId,
        documentFlagResponseDto.relatedDocumentId
      ) &&
      Objects.equals(
        this.relatedChunkId,
        documentFlagResponseDto.relatedChunkId
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      documentId,
      documentTitle,
      flagType,
      severity,
      detail,
      confidenceScore,
      detectedAt,
      resolvedAt,
      resolvedById,
      resolution,
      resolutionComment,
      relatedDocumentId,
      relatedChunkId
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentFlagResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    documentTitle: ")
      .append(toIndentedString(documentTitle))
      .append("\n");
    sb.append("    flagType: ").append(toIndentedString(flagType)).append("\n");
    sb.append("    severity: ").append(toIndentedString(severity)).append("\n");
    sb.append("    detail: ").append(toIndentedString(detail)).append("\n");
    sb.append("    confidenceScore: ")
      .append(toIndentedString(confidenceScore))
      .append("\n");
    sb.append("    detectedAt: ")
      .append(toIndentedString(detectedAt))
      .append("\n");
    sb.append("    resolvedAt: ")
      .append(toIndentedString(resolvedAt))
      .append("\n");
    sb.append("    resolvedById: ")
      .append(toIndentedString(resolvedById))
      .append("\n");
    sb.append("    resolution: ")
      .append(toIndentedString(resolution))
      .append("\n");
    sb.append("    resolutionComment: ")
      .append(toIndentedString(resolutionComment))
      .append("\n");
    sb.append("    relatedDocumentId: ")
      .append(toIndentedString(relatedDocumentId))
      .append("\n");
    sb.append("    relatedChunkId: ")
      .append(toIndentedString(relatedChunkId))
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

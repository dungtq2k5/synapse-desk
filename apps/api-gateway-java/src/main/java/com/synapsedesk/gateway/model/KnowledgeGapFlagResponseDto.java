package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * KnowledgeGapFlagResponseDto
 */

public class KnowledgeGapFlagResponseDto {

  private String documentId;

  private String documentTitle;

  /**
   * Gets or Sets flagType
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

  private String detail;

  public KnowledgeGapFlagResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeGapFlagResponseDto(
    String documentId,
    String documentTitle,
    FlagTypeEnum flagType,
    String detail
  ) {
    this.documentId = documentId;
    this.documentTitle = documentTitle;
    this.flagType = flagType;
    this.detail = detail;
  }

  public KnowledgeGapFlagResponseDto documentId(String documentId) {
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

  public KnowledgeGapFlagResponseDto documentTitle(String documentTitle) {
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

  public KnowledgeGapFlagResponseDto flagType(FlagTypeEnum flagType) {
    this.flagType = flagType;
    return this;
  }

  /**
   * Get flagType
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

  public KnowledgeGapFlagResponseDto detail(String detail) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeGapFlagResponseDto knowledgeGapFlagResponseDto =
      (KnowledgeGapFlagResponseDto) o;
    return (
      Objects.equals(this.documentId, knowledgeGapFlagResponseDto.documentId) &&
      Objects.equals(
        this.documentTitle,
        knowledgeGapFlagResponseDto.documentTitle
      ) &&
      Objects.equals(this.flagType, knowledgeGapFlagResponseDto.flagType) &&
      Objects.equals(this.detail, knowledgeGapFlagResponseDto.detail)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(documentId, documentTitle, flagType, detail);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeGapFlagResponseDto {\n");
    sb.append("    documentId: ")
      .append(toIndentedString(documentId))
      .append("\n");
    sb.append("    documentTitle: ")
      .append(toIndentedString(documentTitle))
      .append("\n");
    sb.append("    flagType: ").append(toIndentedString(flagType)).append("\n");
    sb.append("    detail: ").append(toIndentedString(detail)).append("\n");
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

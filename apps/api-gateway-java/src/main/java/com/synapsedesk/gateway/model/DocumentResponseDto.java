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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * DocumentResponseDto
 */

public class DocumentResponseDto {

  private String id;

  private String organizationId;

  private String createdById;

  private String title;

  private String fileUrl;

  /**
   * The stored EXTENSION — `pdf`, `txt`, `md` — never the MIME type.  `bin` is a real member: any accepted type with no extension mapping is filed under it, as is a value this build does not recognise.
   */
  public enum FileTypeEnum {
    BIN("bin"),

    DOCX("docx"),

    MD("md"),

    PDF("pdf"),

    TXT("txt");

    private final String value;

    FileTypeEnum(String value) {
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
    public static FileTypeEnum fromValue(String value) {
      for (FileTypeEnum b : FileTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private FileTypeEnum fileType;

  /**
   * Gets or Sets ocrLanguages
   */
  public enum OcrLanguagesEnum {
    DE("de"),

    EN("en"),

    ES("es"),

    FR("fr"),

    JA("ja"),

    PT("pt"),

    VI("vi"),

    ZH("zh");

    private final String value;

    OcrLanguagesEnum(String value) {
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
    public static OcrLanguagesEnum fromValue(String value) {
      for (OcrLanguagesEnum b : OcrLanguagesEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private List<OcrLanguagesEnum> ocrLanguages = new ArrayList<>();

  private BigDecimal fileSizeBytes;

  private Boolean isOrganizationWide;

  /**
   * Gets or Sets status
   */
  public enum StatusEnum {
    FAILED("FAILED"),

    INDEXED("INDEXED"),

    PENDING("PENDING"),

    PROCESSING("PROCESSING");

    private final String value;

    StatusEnum(String value) {
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
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private StatusEnum status = null;

  private List<String> departmentIds = new ArrayList<>();

  private BigDecimal chunkCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  private String deletedById = null;

  public DocumentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentResponseDto(
    String id,
    String organizationId,
    String createdById,
    String title,
    String fileUrl,
    FileTypeEnum fileType,
    List<OcrLanguagesEnum> ocrLanguages,
    BigDecimal fileSizeBytes,
    Boolean isOrganizationWide,
    StatusEnum status,
    List<String> departmentIds,
    BigDecimal chunkCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    OffsetDateTime deletedAt,
    String deletedById
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.createdById = createdById;
    this.title = title;
    this.fileUrl = fileUrl;
    this.fileType = fileType;
    this.ocrLanguages = ocrLanguages;
    this.fileSizeBytes = fileSizeBytes;
    this.isOrganizationWide = isOrganizationWide;
    this.status = status;
    this.departmentIds = departmentIds;
    this.chunkCount = chunkCount;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.deletedAt = deletedAt;
    this.deletedById = deletedById;
  }

  public DocumentResponseDto id(String id) {
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

  public DocumentResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public DocumentResponseDto createdById(String createdById) {
    this.createdById = createdById;
    return this;
  }

  /**
   * Get createdById
   * @return createdById
   */
  @NotNull
  @JsonProperty("createdById")
  public String getCreatedById() {
    return createdById;
  }

  @JsonProperty("createdById")
  public void setCreatedById(String createdById) {
    this.createdById = createdById;
  }

  public DocumentResponseDto title(String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @NotNull
  @JsonProperty("title")
  public String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(String title) {
    this.title = title;
  }

  public DocumentResponseDto fileUrl(String fileUrl) {
    this.fileUrl = fileUrl;
    return this;
  }

  /**
   * An internal object path today; a signed URL only via `/download`.
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

  public DocumentResponseDto fileType(FileTypeEnum fileType) {
    this.fileType = fileType;
    return this;
  }

  /**
   * The stored EXTENSION — `pdf`, `txt`, `md` — never the MIME type.  `bin` is a real member: any accepted type with no extension mapping is filed under it, as is a value this build does not recognise.
   * @return fileType
   */
  @NotNull
  @JsonProperty("fileType")
  public FileTypeEnum getFileType() {
    return fileType;
  }

  @JsonProperty("fileType")
  public void setFileType(FileTypeEnum fileType) {
    this.fileType = fileType;
  }

  public DocumentResponseDto ocrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
    return this;
  }

  public DocumentResponseDto addOcrLanguagesItem(
    OcrLanguagesEnum ocrLanguagesItem
  ) {
    if (this.ocrLanguages == null) {
      this.ocrLanguages = new ArrayList<>();
    }
    this.ocrLanguages.add(ocrLanguagesItem);
    return this;
  }

  /**
   * ISO 639-1 codes the uploader declared for OCR.  `[]` means \"not specified\" — never `null`, so absent and empty are one value all the way to the client.
   * @return ocrLanguages
   */
  @NotNull
  @JsonProperty("ocrLanguages")
  public List<OcrLanguagesEnum> getOcrLanguages() {
    return ocrLanguages;
  }

  @JsonProperty("ocrLanguages")
  public void setOcrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
  }

  public DocumentResponseDto fileSizeBytes(BigDecimal fileSizeBytes) {
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

  public DocumentResponseDto isOrganizationWide(Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
    return this;
  }

  /**
   * Get isOrganizationWide
   * @return isOrganizationWide
   */
  @NotNull
  @JsonProperty("isOrganizationWide")
  public Boolean getIsOrganizationWide() {
    return isOrganizationWide;
  }

  @JsonProperty("isOrganizationWide")
  public void setIsOrganizationWide(Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
  }

  public DocumentResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
   * @return status
   */

  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public DocumentResponseDto departmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public DocumentResponseDto addDepartmentIdsItem(String departmentIdsItem) {
    if (this.departmentIds == null) {
      this.departmentIds = new ArrayList<>();
    }
    this.departmentIds.add(departmentIdsItem);
    return this;
  }

  /**
   * Get departmentIds
   * @return departmentIds
   */
  @NotNull
  @JsonProperty("departmentIds")
  public List<String> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public DocumentResponseDto chunkCount(BigDecimal chunkCount) {
    this.chunkCount = chunkCount;
    return this;
  }

  /**
   * Get chunkCount
   * @return chunkCount
   */
  @NotNull
  @Valid
  @JsonProperty("chunkCount")
  public BigDecimal getChunkCount() {
    return chunkCount;
  }

  @JsonProperty("chunkCount")
  public void setChunkCount(BigDecimal chunkCount) {
    this.chunkCount = chunkCount;
  }

  public DocumentResponseDto createdAt(OffsetDateTime createdAt) {
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

  public DocumentResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  public DocumentResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Get deletedAt
   * @return deletedAt
   */
  @Valid
  @JsonProperty("deletedAt")
  public OffsetDateTime getDeletedAt() {
    return deletedAt;
  }

  @JsonProperty("deletedAt")
  public void setDeletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
  }

  public DocumentResponseDto deletedById(String deletedById) {
    this.deletedById = deletedById;
    return this;
  }

  /**
   * Get deletedById
   * @return deletedById
   */

  @JsonProperty("deletedById")
  public String getDeletedById() {
    return deletedById;
  }

  @JsonProperty("deletedById")
  public void setDeletedById(String deletedById) {
    this.deletedById = deletedById;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentResponseDto documentResponseDto = (DocumentResponseDto) o;
    return (
      Objects.equals(this.id, documentResponseDto.id) &&
      Objects.equals(this.organizationId, documentResponseDto.organizationId) &&
      Objects.equals(this.createdById, documentResponseDto.createdById) &&
      Objects.equals(this.title, documentResponseDto.title) &&
      Objects.equals(this.fileUrl, documentResponseDto.fileUrl) &&
      Objects.equals(this.fileType, documentResponseDto.fileType) &&
      Objects.equals(this.ocrLanguages, documentResponseDto.ocrLanguages) &&
      Objects.equals(this.fileSizeBytes, documentResponseDto.fileSizeBytes) &&
      Objects.equals(
        this.isOrganizationWide,
        documentResponseDto.isOrganizationWide
      ) &&
      Objects.equals(this.status, documentResponseDto.status) &&
      Objects.equals(this.departmentIds, documentResponseDto.departmentIds) &&
      Objects.equals(this.chunkCount, documentResponseDto.chunkCount) &&
      Objects.equals(this.createdAt, documentResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, documentResponseDto.updatedAt) &&
      Objects.equals(this.deletedAt, documentResponseDto.deletedAt) &&
      Objects.equals(this.deletedById, documentResponseDto.deletedById)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      organizationId,
      createdById,
      title,
      fileUrl,
      fileType,
      ocrLanguages,
      fileSizeBytes,
      isOrganizationWide,
      status,
      departmentIds,
      chunkCount,
      createdAt,
      updatedAt,
      deletedAt,
      deletedById
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    createdById: ")
      .append(toIndentedString(createdById))
      .append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    fileUrl: ").append(toIndentedString(fileUrl)).append("\n");
    sb.append("    fileType: ").append(toIndentedString(fileType)).append("\n");
    sb.append("    ocrLanguages: ")
      .append(toIndentedString(ocrLanguages))
      .append("\n");
    sb.append("    fileSizeBytes: ")
      .append(toIndentedString(fileSizeBytes))
      .append("\n");
    sb.append("    isOrganizationWide: ")
      .append(toIndentedString(isOrganizationWide))
      .append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    departmentIds: ")
      .append(toIndentedString(departmentIds))
      .append("\n");
    sb.append("    chunkCount: ")
      .append(toIndentedString(chunkCount))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
      .append("\n");
    sb.append("    deletedAt: ")
      .append(toIndentedString(deletedAt))
      .append("\n");
    sb.append("    deletedById: ")
      .append(toIndentedString(deletedById))
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

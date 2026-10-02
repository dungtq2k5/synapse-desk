package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.lang.Nullable;

/**
 * ConfirmDocumentDto
 */

public class ConfirmDocumentDto {

  private Boolean isOrganizationWide = true;

  private List<UUID> departmentIds = new ArrayList<>();

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

  private String objectPath;

  private String title;

  private @Nullable String fileName;

  public ConfirmDocumentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ConfirmDocumentDto(String objectPath, String title) {
    this.objectPath = objectPath;
    this.title = title;
  }

  public ConfirmDocumentDto isOrganizationWide(Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
    return this;
  }

  /**
   * Defaults TRUE, matching RDM Table 17.  The permissive default is deliberate and worth stating: a knowledge base whose documents defaulted to invisible would look broken to everyone who did not also configure departments, and the failure mode of the other default — a document nobody can find — is a support ticket rather than a disclosure. Restricting is then an explicit act.
   * @return isOrganizationWide
   */

  @JsonProperty("isOrganizationWide")
  public Boolean getIsOrganizationWide() {
    return isOrganizationWide;
  }

  @JsonProperty("isOrganizationWide")
  public void setIsOrganizationWide(Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
  }

  public ConfirmDocumentDto departmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public ConfirmDocumentDto addDepartmentIdsItem(UUID departmentIdsItem) {
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
  @Valid
  @JsonProperty("departmentIds")
  public List<UUID> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<UUID> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public ConfirmDocumentDto ocrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
    return this;
  }

  public ConfirmDocumentDto addOcrLanguagesItem(
    OcrLanguagesEnum ocrLanguagesItem
  ) {
    if (this.ocrLanguages == null) {
      this.ocrLanguages = new ArrayList<>();
    }
    this.ocrLanguages.add(ocrLanguagesItem);
    return this;
  }

  /**
   * ISO 639-1 codes for OCR, if the uploader knows them.  An advanced field: leave it empty unless the upload is known to be scanned. `[]` and absent are the same thing, and the parser falls back to `eng`.
   * @return ocrLanguages
   */

  @JsonProperty("ocrLanguages")
  public List<OcrLanguagesEnum> getOcrLanguages() {
    return ocrLanguages;
  }

  @JsonProperty("ocrLanguages")
  public void setOcrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
  }

  public ConfirmDocumentDto objectPath(String objectPath) {
    this.objectPath = objectPath;
    return this;
  }

  /**
   * The object path, echoed back from the presign response.
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

  public ConfirmDocumentDto title(String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @NotNull
  @Size(min = 1, max = 255)
  @JsonProperty("title")
  public String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(String title) {
    this.title = title;
  }

  public ConfirmDocumentDto fileName(@Nullable String fileName) {
    this.fileName = fileName;
    return this;
  }

  /**
   * Get fileName
   * @return fileName
   */
  @Size(max = 255)
  @JsonProperty("fileName")
  public @Nullable String getFileName() {
    return fileName;
  }

  @JsonProperty("fileName")
  public void setFileName(@Nullable String fileName) {
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
    ConfirmDocumentDto confirmDocumentDto = (ConfirmDocumentDto) o;
    return (
      Objects.equals(
        this.isOrganizationWide,
        confirmDocumentDto.isOrganizationWide
      ) &&
      Objects.equals(this.departmentIds, confirmDocumentDto.departmentIds) &&
      Objects.equals(this.ocrLanguages, confirmDocumentDto.ocrLanguages) &&
      Objects.equals(this.objectPath, confirmDocumentDto.objectPath) &&
      Objects.equals(this.title, confirmDocumentDto.title) &&
      Objects.equals(this.fileName, confirmDocumentDto.fileName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      isOrganizationWide,
      departmentIds,
      ocrLanguages,
      objectPath,
      title,
      fileName
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ConfirmDocumentDto {\n");
    sb.append("    isOrganizationWide: ")
      .append(toIndentedString(isOrganizationWide))
      .append("\n");
    sb.append("    departmentIds: ")
      .append(toIndentedString(departmentIds))
      .append("\n");
    sb.append("    ocrLanguages: ")
      .append(toIndentedString(ocrLanguages))
      .append("\n");
    sb.append("    objectPath: ")
      .append(toIndentedString(objectPath))
      .append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
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

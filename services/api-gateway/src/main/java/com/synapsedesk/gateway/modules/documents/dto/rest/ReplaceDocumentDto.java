package com.synapsedesk.gateway.modules.documents.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * ReplaceDocumentDto
 */

public class ReplaceDocumentDto {

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

  public ReplaceDocumentDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ReplaceDocumentDto(String objectPath) {
    this.objectPath = objectPath;
  }

  public ReplaceDocumentDto ocrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
    return this;
  }

  public ReplaceDocumentDto addOcrLanguagesItem(
    OcrLanguagesEnum ocrLanguagesItem
  ) {
    if (this.ocrLanguages == null) {
      this.ocrLanguages = new ArrayList<>();
    }
    this.ocrLanguages.add(ocrLanguagesItem);
    return this;
  }

  /**
   * ISO 639-1 codes for OCR, if the uploader knows them.  Re-declared rather than inherited, and NOT carried over from the document being replaced: reading a scan in the wrong language is one of the main reasons to replace one, so the previous value is exactly what a caller may be here to change. Absent means `[]`, which is the `eng` fallback — the same meaning it has on confirm.
   * @return ocrLanguages
   */

  @Schema(defaultValue = "[]")
  @JsonProperty("ocrLanguages")
  public List<OcrLanguagesEnum> getOcrLanguages() {
    return ocrLanguages;
  }

  @JsonProperty("ocrLanguages")
  public void setOcrLanguages(List<OcrLanguagesEnum> ocrLanguages) {
    this.ocrLanguages = ocrLanguages;
  }

  public ReplaceDocumentDto objectPath(String objectPath) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ReplaceDocumentDto replaceDocumentDto = (ReplaceDocumentDto) o;
    return (
      Objects.equals(this.ocrLanguages, replaceDocumentDto.ocrLanguages) &&
      Objects.equals(this.objectPath, replaceDocumentDto.objectPath)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(ocrLanguages, objectPath);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ReplaceDocumentDto {\n");
    sb.append("    ocrLanguages: ")
      .append(toIndentedString(ocrLanguages))
      .append("\n");
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

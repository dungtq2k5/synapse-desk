package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * GenerateTwoFactorResponseDto
 */

public class GenerateTwoFactorResponseDto {

  private String otpauthUri;

  private String qrCodeDataUrl;

  public GenerateTwoFactorResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public GenerateTwoFactorResponseDto(String otpauthUri, String qrCodeDataUrl) {
    this.otpauthUri = otpauthUri;
    this.qrCodeDataUrl = qrCodeDataUrl;
  }

  public GenerateTwoFactorResponseDto otpauthUri(String otpauthUri) {
    this.otpauthUri = otpauthUri;
    return this;
  }

  /**
   * Get otpauthUri
   * @return otpauthUri
   */
  @NotNull
  @JsonProperty("otpauthUri")
  public String getOtpauthUri() {
    return otpauthUri;
  }

  @JsonProperty("otpauthUri")
  public void setOtpauthUri(String otpauthUri) {
    this.otpauthUri = otpauthUri;
  }

  public GenerateTwoFactorResponseDto qrCodeDataUrl(String qrCodeDataUrl) {
    this.qrCodeDataUrl = qrCodeDataUrl;
    return this;
  }

  /**
   * Get qrCodeDataUrl
   * @return qrCodeDataUrl
   */
  @NotNull
  @JsonProperty("qrCodeDataUrl")
  public String getQrCodeDataUrl() {
    return qrCodeDataUrl;
  }

  @JsonProperty("qrCodeDataUrl")
  public void setQrCodeDataUrl(String qrCodeDataUrl) {
    this.qrCodeDataUrl = qrCodeDataUrl;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    GenerateTwoFactorResponseDto generateTwoFactorResponseDto =
      (GenerateTwoFactorResponseDto) o;
    return (
      Objects.equals(
        this.otpauthUri,
        generateTwoFactorResponseDto.otpauthUri
      ) &&
      Objects.equals(
        this.qrCodeDataUrl,
        generateTwoFactorResponseDto.qrCodeDataUrl
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(otpauthUri, qrCodeDataUrl);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class GenerateTwoFactorResponseDto {\n");
    sb.append("    otpauthUri: ")
      .append(toIndentedString(otpauthUri))
      .append("\n");
    sb.append("    qrCodeDataUrl: ")
      .append(toIndentedString(qrCodeDataUrl))
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

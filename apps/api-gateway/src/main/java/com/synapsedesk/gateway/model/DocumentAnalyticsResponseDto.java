package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.DocumentUsageResponseDto;
import com.synapsedesk.gateway.model.RateResponseDto;
import com.synapsedesk.gateway.model.UnavailableBlockResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * DocumentAnalyticsResponseDto
 */

public class DocumentAnalyticsResponseDto {

  private List<@Valid DocumentUsageResponseDto> mostCited = new ArrayList<>();

  private List<@Valid DocumentUsageResponseDto> neverRetrieved =
    new ArrayList<>();

  private List<@Valid DocumentUsageResponseDto> retrievedNeverCited =
    new ArrayList<>();

  private RateResponseDto citationAccuracy = null;

  private String dataThrough = null;

  private List<@Valid UnavailableBlockResponseDto> unavailable =
    new ArrayList<>();

  public DocumentAnalyticsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DocumentAnalyticsResponseDto(
    List<@Valid DocumentUsageResponseDto> mostCited,
    List<@Valid DocumentUsageResponseDto> neverRetrieved,
    List<@Valid DocumentUsageResponseDto> retrievedNeverCited,
    RateResponseDto citationAccuracy,
    String dataThrough,
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.mostCited = mostCited;
    this.neverRetrieved = neverRetrieved;
    this.retrievedNeverCited = retrievedNeverCited;
    this.citationAccuracy = citationAccuracy;
    this.dataThrough = dataThrough;
    this.unavailable = unavailable;
  }

  public DocumentAnalyticsResponseDto mostCited(
    List<@Valid DocumentUsageResponseDto> mostCited
  ) {
    this.mostCited = mostCited;
    return this;
  }

  public DocumentAnalyticsResponseDto addMostCitedItem(
    DocumentUsageResponseDto mostCitedItem
  ) {
    if (this.mostCited == null) {
      this.mostCited = new ArrayList<>();
    }
    this.mostCited.add(mostCitedItem);
    return this;
  }

  /**
   * Get mostCited
   * @return mostCited
   */
  @NotNull
  @Valid
  @JsonProperty("mostCited")
  public List<@Valid DocumentUsageResponseDto> getMostCited() {
    return mostCited;
  }

  @JsonProperty("mostCited")
  public void setMostCited(List<@Valid DocumentUsageResponseDto> mostCited) {
    this.mostCited = mostCited;
  }

  public DocumentAnalyticsResponseDto neverRetrieved(
    List<@Valid DocumentUsageResponseDto> neverRetrieved
  ) {
    this.neverRetrieved = neverRetrieved;
    return this;
  }

  public DocumentAnalyticsResponseDto addNeverRetrievedItem(
    DocumentUsageResponseDto neverRetrievedItem
  ) {
    if (this.neverRetrieved == null) {
      this.neverRetrieved = new ArrayList<>();
    }
    this.neverRetrieved.add(neverRetrievedItem);
    return this;
  }

  /**
   * **Two DIFFERENT findings** (RDM Table 27), never merged into one list.
   * @return neverRetrieved
   */
  @NotNull
  @Valid
  @JsonProperty("neverRetrieved")
  public List<@Valid DocumentUsageResponseDto> getNeverRetrieved() {
    return neverRetrieved;
  }

  @JsonProperty("neverRetrieved")
  public void setNeverRetrieved(
    List<@Valid DocumentUsageResponseDto> neverRetrieved
  ) {
    this.neverRetrieved = neverRetrieved;
  }

  public DocumentAnalyticsResponseDto retrievedNeverCited(
    List<@Valid DocumentUsageResponseDto> retrievedNeverCited
  ) {
    this.retrievedNeverCited = retrievedNeverCited;
    return this;
  }

  public DocumentAnalyticsResponseDto addRetrievedNeverCitedItem(
    DocumentUsageResponseDto retrievedNeverCitedItem
  ) {
    if (this.retrievedNeverCited == null) {
      this.retrievedNeverCited = new ArrayList<>();
    }
    this.retrievedNeverCited.add(retrievedNeverCitedItem);
    return this;
  }

  /**
   * Get retrievedNeverCited
   * @return retrievedNeverCited
   */
  @NotNull
  @Valid
  @JsonProperty("retrievedNeverCited")
  public List<@Valid DocumentUsageResponseDto> getRetrievedNeverCited() {
    return retrievedNeverCited;
  }

  @JsonProperty("retrievedNeverCited")
  public void setRetrievedNeverCited(
    List<@Valid DocumentUsageResponseDto> retrievedNeverCited
  ) {
    this.retrievedNeverCited = retrievedNeverCited;
  }

  public DocumentAnalyticsResponseDto citationAccuracy(
    RateResponseDto citationAccuracy
  ) {
    this.citationAccuracy = citationAccuracy;
    return this;
  }

  /**
   * Citation accuracy from `ai_response_feedbacks` — the other service's leg.
   * @return citationAccuracy
   */
  @Valid
  @JsonProperty("citationAccuracy")
  public RateResponseDto getCitationAccuracy() {
    return citationAccuracy;
  }

  @JsonProperty("citationAccuracy")
  public void setCitationAccuracy(RateResponseDto citationAccuracy) {
    this.citationAccuracy = citationAccuracy;
  }

  public DocumentAnalyticsResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * See `AgentAnalyticsResponseDto.dataThrough`.
   * @return dataThrough
   */

  @JsonProperty("dataThrough")
  public String getDataThrough() {
    return dataThrough;
  }

  @JsonProperty("dataThrough")
  public void setDataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
  }

  public DocumentAnalyticsResponseDto unavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.unavailable = unavailable;
    return this;
  }

  public DocumentAnalyticsResponseDto addUnavailableItem(
    UnavailableBlockResponseDto unavailableItem
  ) {
    if (this.unavailable == null) {
      this.unavailable = new ArrayList<>();
    }
    this.unavailable.add(unavailableItem);
    return this;
  }

  /**
   * Get unavailable
   * @return unavailable
   */
  @NotNull
  @Valid
  @JsonProperty("unavailable")
  public List<@Valid UnavailableBlockResponseDto> getUnavailable() {
    return unavailable;
  }

  @JsonProperty("unavailable")
  public void setUnavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.unavailable = unavailable;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DocumentAnalyticsResponseDto documentAnalyticsResponseDto =
      (DocumentAnalyticsResponseDto) o;
    return (
      Objects.equals(this.mostCited, documentAnalyticsResponseDto.mostCited) &&
      Objects.equals(
        this.neverRetrieved,
        documentAnalyticsResponseDto.neverRetrieved
      ) &&
      Objects.equals(
        this.retrievedNeverCited,
        documentAnalyticsResponseDto.retrievedNeverCited
      ) &&
      Objects.equals(
        this.citationAccuracy,
        documentAnalyticsResponseDto.citationAccuracy
      ) &&
      Objects.equals(
        this.dataThrough,
        documentAnalyticsResponseDto.dataThrough
      ) &&
      Objects.equals(this.unavailable, documentAnalyticsResponseDto.unavailable)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      mostCited,
      neverRetrieved,
      retrievedNeverCited,
      citationAccuracy,
      dataThrough,
      unavailable
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DocumentAnalyticsResponseDto {\n");
    sb.append("    mostCited: ")
      .append(toIndentedString(mostCited))
      .append("\n");
    sb.append("    neverRetrieved: ")
      .append(toIndentedString(neverRetrieved))
      .append("\n");
    sb.append("    retrievedNeverCited: ")
      .append(toIndentedString(retrievedNeverCited))
      .append("\n");
    sb.append("    citationAccuracy: ")
      .append(toIndentedString(citationAccuracy))
      .append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
      .append("\n");
    sb.append("    unavailable: ")
      .append(toIndentedString(unavailable))
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

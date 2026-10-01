package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonTypeName;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * InvitationsControllerListV1200ResponseDataMeta
 */

@JsonTypeName("InvitationsController_list_v1_200_response_data_meta")
public class InvitationsControllerListV1200ResponseDataMeta {

  private BigDecimal totalItems;

  private BigDecimal itemCount;

  private BigDecimal itemsPerPage;

  private BigDecimal totalPages;

  private BigDecimal currentPage;

  public InvitationsControllerListV1200ResponseDataMeta() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InvitationsControllerListV1200ResponseDataMeta(BigDecimal totalItems, BigDecimal itemCount, BigDecimal itemsPerPage, BigDecimal totalPages, BigDecimal currentPage) {
    this.totalItems = totalItems;
    this.itemCount = itemCount;
    this.itemsPerPage = itemsPerPage;
    this.totalPages = totalPages;
    this.currentPage = currentPage;
  }

  public InvitationsControllerListV1200ResponseDataMeta totalItems(BigDecimal totalItems) {
    this.totalItems = totalItems;
    return this;
  }

  /**
   * Total matching records, across every page.
   * @return totalItems
   */
  @NotNull @Valid 
  @JsonProperty("totalItems")
  public BigDecimal getTotalItems() {
    return totalItems;
  }

  @JsonProperty("totalItems")
  public void setTotalItems(BigDecimal totalItems) {
    this.totalItems = totalItems;
  }

  public InvitationsControllerListV1200ResponseDataMeta itemCount(BigDecimal itemCount) {
    this.itemCount = itemCount;
    return this;
  }

  /**
   * Records on THIS page.
   * @return itemCount
   */
  @NotNull @Valid 
  @JsonProperty("itemCount")
  public BigDecimal getItemCount() {
    return itemCount;
  }

  @JsonProperty("itemCount")
  public void setItemCount(BigDecimal itemCount) {
    this.itemCount = itemCount;
  }

  public InvitationsControllerListV1200ResponseDataMeta itemsPerPage(BigDecimal itemsPerPage) {
    this.itemsPerPage = itemsPerPage;
    return this;
  }

  /**
   * Get itemsPerPage
   * @return itemsPerPage
   */
  @NotNull @Valid 
  @JsonProperty("itemsPerPage")
  public BigDecimal getItemsPerPage() {
    return itemsPerPage;
  }

  @JsonProperty("itemsPerPage")
  public void setItemsPerPage(BigDecimal itemsPerPage) {
    this.itemsPerPage = itemsPerPage;
  }

  public InvitationsControllerListV1200ResponseDataMeta totalPages(BigDecimal totalPages) {
    this.totalPages = totalPages;
    return this;
  }

  /**
   * Get totalPages
   * @return totalPages
   */
  @NotNull @Valid 
  @JsonProperty("totalPages")
  public BigDecimal getTotalPages() {
    return totalPages;
  }

  @JsonProperty("totalPages")
  public void setTotalPages(BigDecimal totalPages) {
    this.totalPages = totalPages;
  }

  public InvitationsControllerListV1200ResponseDataMeta currentPage(BigDecimal currentPage) {
    this.currentPage = currentPage;
    return this;
  }

  /**
   * Get currentPage
   * @return currentPage
   */
  @NotNull @Valid 
  @JsonProperty("currentPage")
  public BigDecimal getCurrentPage() {
    return currentPage;
  }

  @JsonProperty("currentPage")
  public void setCurrentPage(BigDecimal currentPage) {
    this.currentPage = currentPage;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    InvitationsControllerListV1200ResponseDataMeta invitationsControllerListV1200ResponseDataMeta = (InvitationsControllerListV1200ResponseDataMeta) o;
    return Objects.equals(this.totalItems, invitationsControllerListV1200ResponseDataMeta.totalItems) &&
        Objects.equals(this.itemCount, invitationsControllerListV1200ResponseDataMeta.itemCount) &&
        Objects.equals(this.itemsPerPage, invitationsControllerListV1200ResponseDataMeta.itemsPerPage) &&
        Objects.equals(this.totalPages, invitationsControllerListV1200ResponseDataMeta.totalPages) &&
        Objects.equals(this.currentPage, invitationsControllerListV1200ResponseDataMeta.currentPage);
  }

  @Override
  public int hashCode() {
    return Objects.hash(totalItems, itemCount, itemsPerPage, totalPages, currentPage);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InvitationsControllerListV1200ResponseDataMeta {\n");
    sb.append("    totalItems: ").append(toIndentedString(totalItems)).append("\n");
    sb.append("    itemCount: ").append(toIndentedString(itemCount)).append("\n");
    sb.append("    itemsPerPage: ").append(toIndentedString(itemsPerPage)).append("\n");
    sb.append("    totalPages: ").append(toIndentedString(totalPages)).append("\n");
    sb.append("    currentPage: ").append(toIndentedString(currentPage)).append("\n");
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


package com.synapsedesk.gateway.modules.knowledge.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * PaginationMetaDataResponseDto
 */

public class PaginationMetaDataResponseDto {

  private BigDecimal totalItems;

  private BigDecimal itemCount;

  private BigDecimal itemsPerPage;

  private BigDecimal totalPages;

  private BigDecimal currentPage;

  public PaginationMetaDataResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PaginationMetaDataResponseDto(
    BigDecimal totalItems,
    BigDecimal itemCount,
    BigDecimal itemsPerPage,
    BigDecimal totalPages,
    BigDecimal currentPage
  ) {
    this.totalItems = totalItems;
    this.itemCount = itemCount;
    this.itemsPerPage = itemsPerPage;
    this.totalPages = totalPages;
    this.currentPage = currentPage;
  }

  public PaginationMetaDataResponseDto totalItems(BigDecimal totalItems) {
    this.totalItems = totalItems;
    return this;
  }

  /**
   * Total matching records, across every page.
   * @return totalItems
   */
  @NotNull
  @Valid
  @JsonProperty("totalItems")
  public BigDecimal getTotalItems() {
    return totalItems;
  }

  @JsonProperty("totalItems")
  public void setTotalItems(BigDecimal totalItems) {
    this.totalItems = totalItems;
  }

  public PaginationMetaDataResponseDto itemCount(BigDecimal itemCount) {
    this.itemCount = itemCount;
    return this;
  }

  /**
   * Records on THIS page — smaller than `itemsPerPage` on the last one.
   * @return itemCount
   */
  @NotNull
  @Valid
  @JsonProperty("itemCount")
  public BigDecimal getItemCount() {
    return itemCount;
  }

  @JsonProperty("itemCount")
  public void setItemCount(BigDecimal itemCount) {
    this.itemCount = itemCount;
  }

  public PaginationMetaDataResponseDto itemsPerPage(BigDecimal itemsPerPage) {
    this.itemsPerPage = itemsPerPage;
    return this;
  }

  /**
   * The requested page size.
   * @return itemsPerPage
   */
  @NotNull
  @Valid
  @JsonProperty("itemsPerPage")
  public BigDecimal getItemsPerPage() {
    return itemsPerPage;
  }

  @JsonProperty("itemsPerPage")
  public void setItemsPerPage(BigDecimal itemsPerPage) {
    this.itemsPerPage = itemsPerPage;
  }

  public PaginationMetaDataResponseDto totalPages(BigDecimal totalPages) {
    this.totalPages = totalPages;
    return this;
  }

  /**
   * Get totalPages
   * @return totalPages
   */
  @NotNull
  @Valid
  @JsonProperty("totalPages")
  public BigDecimal getTotalPages() {
    return totalPages;
  }

  @JsonProperty("totalPages")
  public void setTotalPages(BigDecimal totalPages) {
    this.totalPages = totalPages;
  }

  public PaginationMetaDataResponseDto currentPage(BigDecimal currentPage) {
    this.currentPage = currentPage;
    return this;
  }

  /**
   * Get currentPage
   * @return currentPage
   */
  @NotNull
  @Valid
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
    PaginationMetaDataResponseDto paginationMetaDataResponseDto =
      (PaginationMetaDataResponseDto) o;
    return (
      Objects.equals(
        this.totalItems,
        paginationMetaDataResponseDto.totalItems
      ) &&
      Objects.equals(this.itemCount, paginationMetaDataResponseDto.itemCount) &&
      Objects.equals(
        this.itemsPerPage,
        paginationMetaDataResponseDto.itemsPerPage
      ) &&
      Objects.equals(
        this.totalPages,
        paginationMetaDataResponseDto.totalPages
      ) &&
      Objects.equals(
        this.currentPage,
        paginationMetaDataResponseDto.currentPage
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      totalItems,
      itemCount,
      itemsPerPage,
      totalPages,
      currentPage
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PaginationMetaDataResponseDto {\n");
    sb.append("    totalItems: ")
      .append(toIndentedString(totalItems))
      .append("\n");
    sb.append("    itemCount: ")
      .append(toIndentedString(itemCount))
      .append("\n");
    sb.append("    itemsPerPage: ")
      .append(toIndentedString(itemsPerPage))
      .append("\n");
    sb.append("    totalPages: ")
      .append(toIndentedString(totalPages))
      .append("\n");
    sb.append("    currentPage: ")
      .append(toIndentedString(currentPage))
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

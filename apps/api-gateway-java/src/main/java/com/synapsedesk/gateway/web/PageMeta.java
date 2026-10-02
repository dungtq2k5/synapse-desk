package com.synapsedesk.gateway.web;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * The paginated-list `meta` shape, shared by every list route.
 *
 * <p>{@code BigDecimal}, matching every other numeric field the DTO classes
 * carry for a {@code type: number} property.
 */
public record PageMeta(
  @NotNull BigDecimal totalItems,
  @NotNull BigDecimal itemCount,
  @NotNull BigDecimal itemsPerPage,
  @NotNull BigDecimal totalPages,
  @NotNull BigDecimal currentPage
) {
  /** Every controller built this by hand off `synapsedesk.auth.Common.PageMeta` — one place now. */
  public static PageMeta from(synapsedesk.auth.Common.PageMeta meta) {
    return new PageMeta(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
    );
  }
}

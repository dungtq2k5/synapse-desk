package com.synapsedesk.gateway.web;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * The paginated-list `meta` shape, shared by every list route.
 *
 * <p>{@code BigDecimal}, matching every other numeric field the DTO classes
 * carry for a {@code type: number} property.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
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

package com.synapsedesk.gateway.web;

import java.math.BigDecimal;

/**
 * The paginated-list `meta` shape, real rather than borrowed —
 * `InvitationsControllerListV1200ResponseDataMeta` was already being reused
 * as this de facto type across 15 controllers before this class existed,
 * proof that the shape was always the contract and the generated name was
 * never more than an accident of which endpoint happened to be generated
 * first.
 *
 * <p>{@code BigDecimal}, matching every generated numeric field this
 * generator has ever produced for a {@code type: number} property — not a
 * shape change, just this shape's real name.
 */
public record PageMeta(
  BigDecimal totalItems,
  BigDecimal itemCount,
  BigDecimal itemsPerPage,
  BigDecimal totalPages,
  BigDecimal currentPage
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

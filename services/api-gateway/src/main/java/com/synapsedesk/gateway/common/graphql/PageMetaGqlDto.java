package com.synapsedesk.gateway.common.graphql;

/** `PageMeta` — the shared page envelope every list-shaped root field returns. */
public record PageMetaGqlDto(
  int totalItems,
  int itemCount,
  int itemsPerPage,
  int totalPages,
  int currentPage
) {}

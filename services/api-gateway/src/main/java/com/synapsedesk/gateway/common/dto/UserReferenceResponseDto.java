package com.synapsedesk.gateway.common.dto;

import jakarta.validation.constraints.NotNull;

/**
 * A person a response names: enough to show them, nothing to contact them by.
 * Resolved for the caller's organization with inactive users included, so a past
 * agent still has a name in an old thread.
 *
 * <p>{@code @NotNull} documents here; it does not validate (see {@code
 * ResponseSchemasOpenApiCustomizer}).
 */
public record UserReferenceResponseDto(
  @NotNull String id,
  @NotNull String fullName,
  String avatarUrl
) {}

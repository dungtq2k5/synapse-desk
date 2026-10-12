package com.synapsedesk.gateway.common.dto;

import jakarta.validation.constraints.NotNull;

/**
 * A department a response names. {@code @NotNull} documents here; it does not
 * validate (see {@code ResponseSchemasOpenApiCustomizer}).
 */
public record DepartmentReferenceResponseDto(
  @NotNull String id,
  @NotNull String name
) {}

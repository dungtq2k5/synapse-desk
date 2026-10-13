package com.synapsedesk.gateway.modules.sessions.dto.rest;

import jakarta.validation.constraints.NotNull;

/**
 * `{ revokedCount: number }` — the {@code data} that {@code
 * SessionsController} and {@code UserSessionsController} return from their
 * revoke routes, named rather than left as {@code ApiResponse<Object>}, and
 * rather than reusing an unrelated route's wrapper class.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 */
public record RevokedCountDto(@NotNull int revokedCount) {}

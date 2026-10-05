package com.synapsedesk.gateway.sessions;

import jakarta.validation.constraints.NotNull;

/**
 * `{ revokedCount: number }` — `sessions.controller.ts`'s
 * `Promise<{ revokedCount: number }>` and `user-sessions.controller.ts`'s
 * own copy of the same shape, named rather than left as {@code
 * ApiResponse<Object>}. Neither route's generated response carries a real
 * model for {@code data} — Node's own {@code @ApiWrappedResponse()}
 * declares none — so this is the shape the handler actually returns, given
 * a name instead of reusing an unrelated route's wrapper class.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 */
public record RevokedCountDto(@NotNull int revokedCount) {}

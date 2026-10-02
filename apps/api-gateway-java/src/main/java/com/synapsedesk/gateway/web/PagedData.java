package com.synapsedesk.gateway.web;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * A paginated list's `data` shape — the same artifact class as {@link
 * ApiResponse}, one level deeper: one generic type for every list endpoint's
 * identical `{items, meta}` shape.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 */
public record PagedData<T>(@NotNull List<T> items, @NotNull PageMeta meta) {}

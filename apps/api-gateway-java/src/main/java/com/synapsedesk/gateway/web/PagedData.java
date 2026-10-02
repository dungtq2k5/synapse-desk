package com.synapsedesk.gateway.web;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * A paginated list's `data` shape — the same artifact class as {@link
 * ApiResponse}, one level deeper: one generic type for every list endpoint's
 * identical `{items, meta}` shape.
 */
public record PagedData<T>(@NotNull List<T> items, @NotNull PageMeta meta) {}

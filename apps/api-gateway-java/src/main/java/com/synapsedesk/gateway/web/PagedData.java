package com.synapsedesk.gateway.web;

import java.util.List;

/**
 * A paginated list's `data` shape — the same artifact class as {@link
 * ApiResponse}, one level deeper: one generic type for every list endpoint's
 * identical `{items, meta}` shape.
 */
public record PagedData<T>(List<T> items, PageMeta meta) {}

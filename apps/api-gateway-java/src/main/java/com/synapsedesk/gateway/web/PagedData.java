package com.synapsedesk.gateway.web;

import java.util.List;

/**
 * A paginated list's `data` shape — the same artifact class as {@link
 * ApiResponse}, one level deeper: `AuditLogsControllerListV1200ResponseData`
 * and its ~18 siblings were one generated class per list endpoint for this
 * identical `{items, meta}` shape.
 */
public record PagedData<T>(List<T> items, PageMeta meta) {}

package com.synapsedesk.gateway.sessions;

/**
 * `{ revokedCount: number }` — `sessions.controller.ts`'s
 * `Promise<{ revokedCount: number }>` and `user-sessions.controller.ts`'s
 * own copy of the same shape, named rather than left as {@code
 * ApiResponse<Object>}. Neither route's generated response carries a real
 * model for {@code data} — Node's own {@code @ApiWrappedResponse()}
 * declares none — so this is the shape the handler actually returns, given
 * a name instead of reusing an unrelated route's wrapper class.
 */
public record RevokedCountDto(int revokedCount) {}

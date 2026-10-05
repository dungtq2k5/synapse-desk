package com.synapsedesk.gateway.realtime;

/**
 * The {@code data} rider on {@code ai:stream:error} — so a client can clear
 * the ONE pending stream that died, not all of them.
 *
 * <p>Node sits this beside the shared HTTP {@code ErrorResponse} envelope
 * (path, statusCode, timestamp — none of which describes a socket frame);
 * this port uses {@link WsResponse} instead, since porting the HTTP
 * exception-filter shape onto WS is out of scope here (see {@link
 * RealtimeGateway}'s own docblock on the same simplification).
 */
public record AiStreamErrorPayload(String streamId, String ticketId) {}

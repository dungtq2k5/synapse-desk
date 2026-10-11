package com.synapsedesk.gateway.modules.realtime;

/**
 * The {@code data} rider on {@code ai:stream:error} — so a client can clear
 * the ONE pending stream that died, not all of them.
 *
 * <p>It travels in a {@link WsResponse}, not the HTTP {@code ErrorResponse}
 * envelope (path, statusCode, timestamp — none of which describes a socket
 * frame); see {@link RealtimeGateway}'s docblock on refused frames.
 */
public record AiStreamErrorPayload(String streamId, String ticketId) {}

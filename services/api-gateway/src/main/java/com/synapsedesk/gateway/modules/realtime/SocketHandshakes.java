package com.synapsedesk.gateway.modules.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.synapsedesk.gateway.common.web.ClientIp;
import io.netty.handler.codec.http.HttpHeaderNames;

/**
 * The two handshake-derived values every gRPC call site needs to build a
 * {@code RequestContext} from a socket's handshake: an IP and a user agent. Extracted on
 * its second use ({@link RealtimeGateway}'s throttle key, {@link
 * TicketAccessService}'s gRPC metadata) rather than copied a third time.
 */
final class SocketHandshakes {

  private SocketHandshakes() {}

  /**
   * {@link ClientIp}'s rule over the handshake: the rightmost {@code X-Forwarded-For}
   * entry, else the socket's peer. Behind the Ingress the peer is the Ingress for
   * every user, so the peer alone would give the whole user base one handshake
   * budget.
   */
  static String ip(SocketIOClient client) {
    var handshake = client.getHandshakeData();

    return ClientIp.of(
      handshake.getHttpHeaders().get("X-Forwarded-For"),
      handshake.getAddress().getAddress().getHostAddress()
    );
  }

  /** @see #ip(SocketIOClient) */
  static String userAgent(SocketIOClient client) {
    String header = client
      .getHandshakeData()
      .getHttpHeaders()
      .get(HttpHeaderNames.USER_AGENT);

    return header == null ? "" : header;
  }
}

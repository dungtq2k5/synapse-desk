package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import io.netty.handler.codec.http.HttpHeaderNames;

/**
 * The two handshake-derived values every gRPC call site needs to build a
 * {@code RequestContext} from a socket's handshake: an IP and a user agent. Extracted on
 * its second use ({@link RealtimeGateway}'s throttle key, {@link
 * TicketAccessService}'s gRPC metadata) rather than copied a third time.
 */
final class SocketHandshakes {

  private SocketHandshakes() {}

  /** {@code CurrentUser.origin}'s own fallback: {@code ""}, never null. */
  static String ip(SocketIOClient client) {
    String address = client
      .getHandshakeData()
      .getAddress()
      .getAddress()
      .getHostAddress();

    return address == null ? "" : address;
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

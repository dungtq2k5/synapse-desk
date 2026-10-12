package com.synapsedesk.gateway.common.web;

/**
 * The caller's IP, one rule for every reader: the HTTP throttle bucket, the request
 * origin (device sessions, the audit trail, IP lockout, the gRPC caller metadata) and
 * the WebSocket handshake.
 *
 * <p>The rightmost non-blank {@code X-Forwarded-For} entry, else the peer address.
 * Exactly one proxy hop is trusted (the Ingress), and it appends the address it saw as
 * the last entry; anything to its left is whatever the client wrote, so reading the
 * leftmost entry would let a caller choose its own bucket or session IP.
 *
 * @example {@code ClientIp.of("198.51.100.7, 203.0.113.9", "10.0.0.5")} is
 *     {@code "203.0.113.9"}
 */
public final class ClientIp {

  private ClientIp() {}

  /** The IP from a raw {@code X-Forwarded-For} value and the connection's peer; never null. */
  public static String of(String forwardedFor, String peerAddress) {
    if (forwardedFor != null) {
      String[] hops = forwardedFor.split(",");
      for (int i = hops.length - 1; i >= 0; i--) {
        String hop = hops[i].trim();
        if (!hop.isEmpty()) return hop;
      }
    }

    return peerAddress == null ? "" : peerAddress;
  }
}

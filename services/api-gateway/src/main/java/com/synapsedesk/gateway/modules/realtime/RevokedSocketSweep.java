package com.synapsedesk.gateway.modules.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIONamespace;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.RevokedSessions;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Disconnects the sockets of a revoked session.
 *
 * <p>A socket authenticates once, at the handshake, which refuses a revoked
 * session; one already connected would otherwise outlive it. Every
 * {@link #INTERVAL} this reads, in one Redis call, which connected sockets'
 * session families are revoked ({@link RevokedSessions}) and disconnects
 * them. The client sees the server close it, re-checks its session, and lands
 * on sign-in. Polled rather than pushed: the revocation is already a Redis
 * key, so a poll needs no event and no consumer.
 */
@Component
class RevokedSocketSweep {

  private static final Logger LOG = LoggerFactory.getLogger(
    RevokedSocketSweep.class
  );

  /** How long a revoked session's socket can stay connected, at most. */
  static final String INTERVAL = "5000";

  private final SocketIONamespace namespace;
  private final RevokedSessions revokedSessions;

  RevokedSocketSweep(
    SocketIONamespace namespace,
    RevokedSessions revokedSessions
  ) {
    this.namespace = namespace;
    this.revokedSessions = revokedSessions;
  }

  @Scheduled(fixedDelayString = INTERVAL)
  void sweep() {
    List<SocketIOClient> clients = new ArrayList<>();
    List<String> sids = new ArrayList<>();
    for (SocketIOClient client : namespace.getAllClients()) {
      if (
        client.getHandshakeData().getAuthToken() instanceof
          JwtPrincipal principal &&
        principal.sid() != null
      ) {
        clients.add(client);
        sids.add(principal.sid());
      }
    }
    if (clients.isEmpty()) {
      return;
    }

    Set<String> revoked = revokedSessions.revokedAmong(sids);
    for (int index = 0; index < clients.size(); index++) {
      if (revoked.contains(sids.get(index))) {
        LOG.info(
          "Disconnecting socket {}: its session was revoked",
          clients.get(index).getSessionId()
        );
        RealtimeGateway.refuse(
          clients.get(index),
          RealtimeEvents.CONNECTION_REFUSED_CODES_UNAUTHENTICATED,
          "Sign in again"
        );
      }
    }
  }
}

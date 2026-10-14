package com.synapsedesk.gateway.modules.realtime;

import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.HandshakeData;
import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIONamespace;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.RevokedSessions;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link RevokedSocketSweep}: a revoked session's sockets go; the rest stay. */
class RevokedSocketSweepTest {

  private final SocketIONamespace namespace = mock(SocketIONamespace.class);
  private final RevokedSessions revokedSessions = mock(RevokedSessions.class);
  private final RevokedSocketSweep sweep = new RevokedSocketSweep(
    namespace,
    revokedSessions
  );

  private static SocketIOClient socketOf(String sid) {
    SocketIOClient client = mock(SocketIOClient.class);
    HandshakeData handshake = new HandshakeData(
      new DefaultHttpHeaders(),
      Map.of(),
      new InetSocketAddress(0),
      "/",
      false
    );
    handshake.setAuthToken(
      new JwtPrincipal(
        "u1",
        "o1",
        false,
        List.of(),
        List.of(),
        true,
        false,
        sid
      )
    );
    when(client.getHandshakeData()).thenReturn(handshake);
    when(client.getSessionId()).thenReturn(UUID.randomUUID());
    return client;
  }

  @Test
  void disconnectsOnlyTheRevokedSessionsSockets() {
    SocketIOClient revoked = socketOf("family-revoked");
    SocketIOClient kept = socketOf("family-kept");
    when(namespace.getAllClients()).thenReturn(List.of(revoked, kept));
    when(revokedSessions.revokedAmong(anyCollection())).thenReturn(
      Set.of("family-revoked")
    );

    sweep.sweep();

    verify(revoked).disconnect();
    verify(kept, never()).disconnect();
  }

  @Test
  void aTokenWithoutASessionIsNeverLookedUp() {
    SocketIOClient older = socketOf(null);
    when(namespace.getAllClients()).thenReturn(List.of(older));

    sweep.sweep();

    verifyNoInteractions(revokedSessions);
    verify(older, never()).disconnect();
  }
}

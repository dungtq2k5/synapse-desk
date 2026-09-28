package com.synapsedesk.gateway.realtime;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.BroadcastOperations;
import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIOServer;
import org.junit.jupiter.api.Test;

/**
 * The opposite property from {@link RealtimeRelayTest}: these two methods
 * MUST use the room's own `sendEvent` convenience — the one that publishes
 * to the {@code RedissonStoreFactory} after delivering locally — because
 * presence and typing start on one replica and must reach every other
 * replica's sockets too. Iterating {@code getClients()} by hand here would
 * silently turn cross-replica delivery into local-only delivery.
 */
class RealtimeBroadcastTest {

  private final SocketIOServer server = mock(SocketIOServer.class);
  private final RealtimeBroadcast broadcast = new RealtimeBroadcast(server);

  @Test
  void broadcastToRoomUsesTheStorePublishingConvenienceMethod() {
    BroadcastOperations room = mock(BroadcastOperations.class);
    when(server.getRoomOperations("org:o1")).thenReturn(room);

    broadcast.broadcastToRoom("org:o1", "presence", "payload");

    verify(room).sendEvent("presence", "payload");
  }

  @Test
  void relayExcludingSenderUsesTheExcludingOverloadOfTheSameFamily() {
    BroadcastOperations room = mock(BroadcastOperations.class);
    SocketIOClient sender = mock(SocketIOClient.class);
    when(server.getRoomOperations("ticket:t1")).thenReturn(room);

    broadcast.relayExcludingSender("ticket:t1", "typing", "payload", sender);

    verify(room).sendEvent("typing", sender, "payload");
  }
}

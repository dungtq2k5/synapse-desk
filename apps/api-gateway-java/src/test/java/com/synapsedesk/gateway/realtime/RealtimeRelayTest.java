package com.synapsedesk.gateway.realtime;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.BroadcastOperations;
import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIOServer;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The one property {@link RealtimeRelay} exists to guarantee: LOCAL-ONLY
 * delivery, and — for {@link RealtimeRelay#relayToRooms} — exactly one frame
 * per client even when that client sits in more than one target room.
 *
 * <p>Sabotage-relevant: calling {@code getRoomOperations(room).sendEvent(...)}
 * instead of iterating {@code getClients()} would ALSO reach the store's
 * cross-replica dispatch — the row {@link #neverCallsTheBroadcastConvenienceMethod}
 * exists to catch that regression directly, not just its symptom.
 */
class RealtimeRelayTest {

  private final SocketIOServer server = mock(SocketIOServer.class);
  private final RealtimeRelay relay = new RealtimeRelay(server);

  @Test
  void relaysToEveryClientInTheRoom() {
    SocketIOClient a = mock(SocketIOClient.class);
    SocketIOClient b = mock(SocketIOClient.class);
    BroadcastOperations room = mock(BroadcastOperations.class);
    when(room.getClients()).thenReturn(List.of(a, b));
    when(server.getRoomOperations("ticket:1")).thenReturn(room);

    relay.relayToRoom("ticket:1", "ticket:updated", "payload");

    verify(a).sendEvent("ticket:updated", "payload");
    verify(b).sendEvent("ticket:updated", "payload");
  }

  @Test
  void neverCallsTheBroadcastConvenienceMethod() {
    SocketIOClient a = mock(SocketIOClient.class);
    BroadcastOperations room = mock(BroadcastOperations.class);
    when(room.getClients()).thenReturn(List.of(a));
    when(server.getRoomOperations("ticket:1")).thenReturn(room);

    relay.relayToRoom("ticket:1", "ticket:updated", "payload");

    // `BroadcastOperations.sendEvent` also publishes to the cross-replica
    // store — calling it here is exactly the N-replicas-N-frames bug.
    verify(room, never()).sendEvent(
      org.mockito.ArgumentMatchers.anyString(),
      org.mockito.ArgumentMatchers.any()
    );
  }

  @Test
  void aClientInTwoTargetRoomsGetsExactlyOneFrame() {
    SocketIOClient inBoth = mock(SocketIOClient.class);
    SocketIOClient onlyInSecond = mock(SocketIOClient.class);

    BroadcastOperations userRoom = mock(BroadcastOperations.class);
    when(userRoom.getClients()).thenReturn(List.of(inBoth));
    when(server.getRoomOperations("user:1")).thenReturn(userRoom);

    BroadcastOperations orgRoom = mock(BroadcastOperations.class);
    when(orgRoom.getClients()).thenReturn(List.of(inBoth, onlyInSecond));
    when(server.getRoomOperations("org:1")).thenReturn(orgRoom);

    relay.relayToRooms(
      List.of("user:1", "org:1"),
      "document:indexed",
      "payload"
    );

    verify(inBoth, org.mockito.Mockito.times(1)).sendEvent(
      "document:indexed",
      "payload"
    );
    verify(onlyInSecond, org.mockito.Mockito.times(1)).sendEvent(
      "document:indexed",
      "payload"
    );
  }
}

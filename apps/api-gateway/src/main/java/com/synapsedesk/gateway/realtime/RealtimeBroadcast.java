package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIOServer;
import org.springframework.stereotype.Component;

/**
 * The genuinely cross-replica half — `broadcastToRoom`/`client.to(room)`,
 * reproduced. Deliberately the OPPOSITE choice from {@link RealtimeRelay}:
 * these two methods use the room's own {@code sendEvent} convenience, which
 * publishes to {@link RealtimeServerConfig}'s {@code RedissonStoreFactory}
 * after delivering locally — presence and typing START on whichever replica
 * a socket happens to be connected to and must reach every OTHER replica's
 * sockets too, the opposite requirement from the NATS-sourced relay (where
 * every replica already gets the event and only local delivery is correct).
 */
@Component
public class RealtimeBroadcast {

  private final SocketIOServer server;

  public RealtimeBroadcast(SocketIOServer server) {
    this.server = server;
  }

  /** Everyone in the room, including whoever triggered it — presence's shape. */
  public void broadcastToRoom(String room, String event, Object payload) {
    server.getRoomOperations(room).sendEvent(event, payload);
  }

  /** Everyone in the room EXCEPT the sender — typing's shape. */
  public void relayExcludingSender(
    String room,
    String event,
    Object payload,
    SocketIOClient sender
  ) {
    server.getRoomOperations(room).sendEvent(event, sender, payload);
  }
}

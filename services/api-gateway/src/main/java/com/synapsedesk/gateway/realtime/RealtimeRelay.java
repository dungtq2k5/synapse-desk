package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.SocketIOClient;
import com.corundumstudio.socketio.SocketIOServer;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * `relayToRoom`/`relayToRooms`, LOCAL-ONLY — delivers to this replica's
 * sockets only, the only relay a NATS-sourced consumer may call.
 *
 * <p><b>Never {@code getRoomOperations(room).sendEvent(...)}.</b> Read from
 * netty-socketio's own source: that convenience method sends to this
 * replica's local members AND THEN publishes to the configured
 * {@code PubSubStore} for cross-replica dispatch — the cluster-wide half,
 * which every NATS-sourced relay must NOT take, because NATS already
 * delivers the event to every replica with no queue group. Taking it too
 * would mean N replicas deliver N frames to the same client. Iterating
 * {@link com.corundumstudio.socketio.BroadcastOperations#getClients()} and
 * calling {@link SocketIOClient#sendEvent} directly never touches that store
 * — {@code Namespace.getRoomClients} backing it is a plain per-JVM map.
 */
@Component
public class RealtimeRelay {

  private final SocketIOServer server;

  public RealtimeRelay(SocketIOServer server) {
    this.server = server;
  }

  /** One room, this replica's own members only. */
  public void relayToRoom(String room, String event, Object payload) {
    for (SocketIOClient client : server.getRoomOperations(room).getClients()) {
      client.sendEvent(event, payload);
    }
  }

  /**
   * Several rooms, ONE emit's worth of dedup — a client in two of them gets
   * the frame once, matching Socket.IO's own within-one-call room dedup
   * (`server.local.to(rooms)`), not the twice a caller would get from two
   * separate {@link #relayToRoom} calls.
   */
  public void relayToRooms(List<String> rooms, String event, Object payload) {
    Set<SocketIOClient> targets = new LinkedHashSet<>();
    for (String room : rooms) {
      targets.addAll(server.getRoomOperations(room).getClients());
    }

    for (SocketIOClient client : targets) {
      client.sendEvent(event, payload);
    }
  }
}

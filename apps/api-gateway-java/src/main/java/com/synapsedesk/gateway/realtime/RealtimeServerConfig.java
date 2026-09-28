package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.Configuration;
import com.corundumstudio.socketio.SocketIONamespace;
import com.corundumstudio.socketio.SocketIOServer;
import com.corundumstudio.socketio.Transport;
import com.corundumstudio.socketio.store.RedissonStoreFactory;
import com.synapsedesk.gateway.config.RealtimeProperties;
import com.synapsedesk.gateway.config.StoreProperties;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.context.annotation.Bean;

/**
 * The `SocketIOServer` bean, with the three settings P1 measured against the
 * repo's own `socket.io-client` pinned: {@link NullPreservingJsonSupport}
 * (nulls kept), `pingTimeout` 20 000 ms (netty-socketio defaults to 60 000;
 * Engine.IO's own default, which the client already expects, is 20 000), and
 * websocket-only transport (P1 measured Node running Engine.IO's own
 * websocket-only configuration).
 *
 * <p><b>Not started here.</b> Constructing the bean does not bind the port —
 * {@link RealtimeGateway} starts and stops it as a {@code LeaseParticipant},
 * so a standby replica holds this bean without ever opening a socket, the
 * same "nothing exists until the lease says so" rule
 * {@code CacheInvalidationConsumer} follows for its NATS subscription.
 *
 * <p>Its own port, not `server.port`: Node's socket.io shares one
 * `http.Server` with the REST/GraphQL stack; netty-socketio is a standalone
 * Netty server that cannot bind the port Tomcat already holds. See
 * {@link RealtimeProperties}.
 *
 * <p>The store factory is {@link RedissonStoreFactory}, not the default
 * in-memory one — the room-emit convenience methods (`sendEvent` on a
 * {@code BroadcastOperations}, as opposed to the manual per-client iteration
 * {@code RealtimeRelay} uses) publish through whatever this is, and only a
 * real pub/sub backing makes that cross-replica.
 */
@org.springframework.context.annotation.Configuration
public class RealtimeServerConfig {

  /**
   * The genuinely cross-replica channel — presence and typing START on
   * whichever replica a socket happens to be connected to and must reach
   * every OTHER replica's sockets too, unlike the NATS-sourced relay above.
   * Spring's default destroy-method inference calls {@code shutdown()} on
   * context close; nothing in {@code SocketIOServer}'s own start/stop
   * lifecycle touches this client, so it is safe across repeated
   * activate/deactivate cycles.
   */
  @Bean
  public RedissonClient redissonClient(StoreProperties store) {
    Config config = new Config();
    config.useSingleServer().setAddress(store.redisUrl());

    return Redisson.create(config);
  }

  @Bean
  public SocketIOServer socketIOServer(
    RealtimeProperties realtime,
    RedissonClient redisson
  ) {
    Configuration config = new Configuration();
    config.setHostname("0.0.0.0");
    config.setPort(realtime.port());
    config.setContext("/socket.io");
    config.setTransports(Transport.WEBSOCKET);
    config.setPingTimeout(20_000);
    config.setJsonSupport(new NullPreservingJsonSupport());
    config.setStoreFactory(new RedissonStoreFactory(redisson));

    return new SocketIOServer(config);
  }

  /**
   * Node's whole realtime surface lives under `/ws` (`@SecureGateway('ws')`),
   * never the default namespace. Registering it is a NAME, not a bind — safe
   * before {@link SocketIOServer#start()}, and required before one: a client
   * connecting to `/ws` before this exists gets netty-socketio's own
   * `"Invalid namespace"` and disconnects immediately (measured).
   */
  @Bean
  public SocketIONamespace realtimeNamespace(SocketIOServer server) {
    return server.addNamespace("/ws");
  }
}

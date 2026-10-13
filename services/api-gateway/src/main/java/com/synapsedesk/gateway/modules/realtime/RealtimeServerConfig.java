package com.synapsedesk.gateway.modules.realtime;

import com.corundumstudio.socketio.Configuration;
import com.corundumstudio.socketio.SocketIONamespace;
import com.corundumstudio.socketio.SocketIOServer;
import com.corundumstudio.socketio.Transport;
import com.corundumstudio.socketio.store.RedissonStoreFactory;
import com.synapsedesk.gateway.common.config.RealtimeProperties;
import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.context.annotation.Bean;

/**
 * The `SocketIOServer` bean, with the three settings P1 measured against the
 * repo's own `socket.io-client` pinned: {@link NullPreservingJsonSupport}
 * (nulls kept), `pingTimeout` 20 000 ms (netty-socketio defaults to 60 000;
 * Engine.IO's own default, which the client already expects, is 20 000), and
 * websocket-only transport.
 *
 * <p><b>Not started here.</b> Constructing the bean does not bind the port —
 * {@link RealtimeGateway} starts and stops it as a {@code RuntimeParticipant}.
 *
 * <p>Its own port, not `server.port`: netty-socketio is a standalone
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
   *
   * <p><b>Lazy, so the gateway boots with Redis down.</b> An eager client
   * connects inside this method, and a refused connection failed the whole
   * context: every route, not just the sockets. Lazily, it connects on first use,
   * which is the socket server's start, and that is retried until Redis answers.
   */
  @Bean
  public RedissonClient redissonClient(StoreProperties store) {
    Config config = new Config();
    config.setLazyInitialization(true);
    config.useSingleServer().setAddress(store.redisUrl());

    return Redisson.create(config);
  }

  /**
   * <b>{@code SO_REUSEADDR} on the listening socket</b>, which netty-socketio leaves
   * off by default. Without it, a gateway restarted on the same host within the
   * TIME_WAIT window (60 s on Linux) cannot bind its realtime port while the
   * previous process's closed connections still hold it: "SocketIO server start
   * failed at port". Tomcat sets it on the HTTP port, which is why only this one
   * failed. Measured: two contract-suite boots failed 43 s and 59 s after a gateway
   * on the same port shut down, and a bare bind reproduces it.
   */
  @Bean
  public SocketIOServer socketIOServer(
    RealtimeProperties realtime,
    RedissonClient redisson
  ) {
    Configuration config = new Configuration();
    config.setHostname("0.0.0.0");
    config.setPort(realtime.port());
    config.getSocketConfig().setReuseAddress(true);
    config.setContext("/socket.io");
    config.setTransports(Transport.WEBSOCKET);
    config.setPingTimeout(20_000);
    config.setJsonSupport(new NullPreservingJsonSupport());
    config.setStoreFactory(new RedissonStoreFactory(redisson));

    return new SocketIOServer(config);
  }

  /**
   * The whole realtime surface lives under `/ws`
   * ({@code REALTIME_SOCKET.namespace} in `packages/contracts`), never the
   * default namespace. Registering it is a NAME, not a bind — safe
   * before {@link SocketIOServer#start()}, and required before one: a client
   * connecting to `/ws` before this exists gets netty-socketio's own
   * `"Invalid namespace"` and disconnects immediately (measured).
   */
  @Bean
  public SocketIONamespace realtimeNamespace(SocketIOServer server) {
    return server.addNamespace(RealtimeEvents.REALTIME_SOCKET_NAMESPACE);
  }
}

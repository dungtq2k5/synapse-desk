package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The `/socket.io` listener's OWN port — separate from {@code server.port}.
 *
 * <p>Node's socket.io shares one {@code http.Server} with everything else;
 * netty-socketio is a standalone Netty server and cannot bind the port
 * Tomcat already holds. The Ingress routes the `/socket.io` path prefix to
 * this port instead, so the client still sees one host — only the routing
 * moved from "one process" to "one rule". Node never reads this key.
 *
 * @param port the netty-socketio listener's port
 */
@Validated
@ConfigurationProperties(prefix = "realtime")
public record RealtimeProperties(@NotNull Integer port) {}

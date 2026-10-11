package com.synapsedesk.gateway.common.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The `/socket.io` listener's OWN port — separate from {@code server.port}.
 *
 * <p>netty-socketio is a standalone Netty server and cannot bind the port
 * Tomcat already holds. The Ingress routes the `/socket.io` path prefix to
 * this port, so the client still sees one host.
 *
 * @param port the netty-socketio listener's port
 */
@Validated
@ConfigurationProperties(prefix = "realtime")
public record RealtimeProperties(@NotNull Integer port) {}

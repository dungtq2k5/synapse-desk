package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The scrape listener, which is a SEPARATE port from the public one.
 *
 * <p>A distinct port is what makes "not reachable from the internet"
 * structural rather than a rule a reverse proxy has to keep enforcing
 * correctly forever, and the host defaults to loopback so a deployment that
 * never thought about it is closed.
 *
 * @param port the scrape listener's port
 * @param host loopback by default; a pod needs {@code 0.0.0.0}
 */
@Validated
@ConfigurationProperties(prefix = "metrics")
public record MetricsProperties(@NotNull Integer port, @NotBlank String host) {}

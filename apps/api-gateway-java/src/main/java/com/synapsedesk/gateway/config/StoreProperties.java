package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The two stores this gateway connects to itself.
 *
 * <p>Redis holds the rate-limit counters, the socket adapter's channels and
 * the implementation lease; NATS is a CONSUMER connection only — the gateway
 * publishes nothing.
 *
 * @param redisUrl the shared Redis
 * @param natsUrl the event bus, consumed only
 */
@Validated
@ConfigurationProperties(prefix = "stores")
public record StoreProperties(@NotBlank String redisUrl, @NotBlank String natsUrl) {}

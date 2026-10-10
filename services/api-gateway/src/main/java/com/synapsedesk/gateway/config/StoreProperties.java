package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The two stores this gateway connects to itself.
 *
 * <p>Redis holds the rate-limit counters, the socket adapter's channels, the
 * response cache and the tenant status. NATS is consumed from, and published to once: the
 * inbound-email rejection that tells notification-service to reply to a sender.
 *
 * @param redisUrl the shared Redis
 * @param natsUrl the event bus
 */
@Validated
@ConfigurationProperties(prefix = "stores")
public record StoreProperties(
  @NotBlank String redisUrl,
  @NotBlank String natsUrl
) {}

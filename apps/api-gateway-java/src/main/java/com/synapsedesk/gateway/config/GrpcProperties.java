package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The five gRPC peers, every one required.
 *
 * <p>Required rather than optional for the reason the Node schema gives per
 * peer: a gateway that boots without one answers 500 on that surface, naming
 * nothing, instead of failing where the misconfiguration actually is.
 *
 * @param authServiceUrl auth-service
 * @param ticketServiceUrl ticket-service
 * @param ingestionServiceUrl ingestion-service
 * @param notificationServiceUrl notification-service
 * @param ragServiceUrl rag-service, the one Python peer
 */
@Validated
@ConfigurationProperties(prefix = "grpc")
public record GrpcProperties(
    @NotBlank String authServiceUrl,
    @NotBlank String ticketServiceUrl,
    @NotBlank String ingestionServiceUrl,
    @NotBlank String notificationServiceUrl,
    @NotBlank String ragServiceUrl) {}

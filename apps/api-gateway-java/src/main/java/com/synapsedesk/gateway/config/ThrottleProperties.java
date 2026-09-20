package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * The four HTTP rate-limit tiers, and the WebSocket handshake limit.
 *
 * <p>TTLs are milliseconds, as the environment carries them and as the Node
 * throttler reads them — not converted here, because unlike a cookie's
 * {@code Max-Age} nothing on the wire carries these in another unit. The one
 * place a unit changes is the cookie, which is why only that class converts.
 *
 * @param shortTtl the burst window
 * @param shortLimit requests allowed in the burst window
 * @param mediumTtl the medium window
 * @param mediumLimit requests allowed in the medium window
 * @param longTtl the long window
 * @param longLimit requests allowed in the long window
 * @param authTtl the auth-route window, deliberately far longer
 * @param authLimit attempts allowed on auth routes
 * @param wsHandshakeLimit handshakes allowed per window
 * @param wsHandshakeTtl the handshake window
 * @param wsHandshakeBlockDuration how long an offender stays blocked
 */
@Validated
@ConfigurationProperties(prefix = "throttle")
public record ThrottleProperties(
    @NotNull Long shortTtl,
    @NotNull Integer shortLimit,
    @NotNull Long mediumTtl,
    @NotNull Integer mediumLimit,
    @NotNull Long longTtl,
    @NotNull Integer longLimit,
    @NotNull Long authTtl,
    @NotNull Integer authLimit,
    @NotNull Integer wsHandshakeLimit,
    @NotNull Long wsHandshakeTtl,
    @NotNull Long wsHandshakeBlockDuration) {}

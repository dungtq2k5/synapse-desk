package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Inbound email: the webhook's secrets and the addresses either side of it.
 *
 * <p>Two secrets, and they are not interchangeable: {@code secret} is shared
 * with notification-service so the two ends agree a message is ours, and
 * {@code resendWebhookSecret} is the provider's signing secret for verifying
 * that a request came from the provider at all.
 *
 * @param secret shared with notification-service
 * @param domain the inbound domain messages arrive on
 * @param sender the From address outbound mail is sent as
 * @param resendWebhookSecret the provider's signing secret
 * @param resendApiKey the receiving key, used to fetch a message body
 */
@Validated
@ConfigurationProperties(prefix = "inbound")
public record InboundEmailProperties(
    @NotBlank String secret,
    @NotBlank String domain,
    @NotBlank String sender,
    @NotBlank String resendWebhookSecret,
    @NotBlank String resendApiKey) {}

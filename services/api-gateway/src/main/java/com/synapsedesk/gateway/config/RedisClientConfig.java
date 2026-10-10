package com.synapsedesk.gateway.config;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.ClientOptions.DisconnectedBehavior;
import org.springframework.boot.data.redis.autoconfigure.LettuceClientConfigurationBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A Redis that is down fails a command at once, rather than holding the request.
 *
 * <p>Lettuce's default, while it reconnects, is to queue every command and replay
 * it once Redis is back, holding the caller until the command timeout. Every route
 * passes the rate limiter, which increments a Redis counter, so a Redis outage
 * held EVERY request, {@code /version} included, for the full timeout. Measured:
 * each request past 90 s, with the limiter's thread parked in
 * {@code AsyncCommand.await}. Rejected instead, each Redis caller's own fallback
 * answers immediately (the cache reads through, the limiter lets the request pass,
 * the tenant status asks auth-service), and Lettuce still reconnects on its own.
 *
 * <p>A Redis that is connected but not answering is bounded by
 * {@code spring.data.redis.timeout} in {@code application.yaml}.
 */
@Configuration
public class RedisClientConfig {

  @Bean
  LettuceClientConfigurationBuilderCustomizer rejectCommandsWhileDisconnected() {
    return builder ->
      builder.clientOptions(
        ClientOptions.builder()
          .disconnectedBehavior(DisconnectedBehavior.REJECT_COMMANDS)
          .build()
      );
  }
}

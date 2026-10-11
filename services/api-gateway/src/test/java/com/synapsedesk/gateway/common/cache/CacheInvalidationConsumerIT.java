package com.synapsedesk.gateway.common.cache;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.synapsedesk.gateway.common.cache.CacheService;
import com.synapsedesk.gateway.common.config.SharedEnvironment;
import com.synapsedesk.gateway.common.config.StoreProperties;
import io.nats.client.Connection;
import io.nats.client.Nats;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * `CacheInvalidationConsumer` against a REAL NATS broker and a REAL Redis —
 * the row that proves {@link CacheInvalidationConsumer#deactivate} actually
 * stops consumption, not merely that its code compiles. Connected the same
 * way {@code CacheServiceIT} is: real infrastructure
 * started outside this process, read from the shared environment.
 */
class CacheInvalidationConsumerIT {

  private StringRedisTemplate redis;
  private LettuceConnectionFactory connections;
  private CacheService cache;
  private CacheInvalidationConsumer consumer;
  private Connection publisherConnection;

  @BeforeEach
  void connect() {
    Map<String, String> env = SharedEnvironment.values();
    String redisUrl = env.getOrDefault("REDIS_URL", "redis://localhost:6379");
    String natsUrl = env.getOrDefault("NATS_URL", "nats://localhost:4222");

    java.net.URI uri = java.net.URI.create(redisUrl);
    var configuration = new RedisStandaloneConfiguration(
      uri.getHost() == null ? "localhost" : uri.getHost(),
      uri.getPort() < 0 ? 6379 : uri.getPort()
    );
    String path = uri.getPath();
    if (path != null && path.length() > 1) {
      configuration.setDatabase(Integer.parseInt(path.substring(1)));
    }

    connections = new LettuceConnectionFactory(configuration);
    connections.afterPropertiesSet();
    redis = new StringRedisTemplate(connections);
    cache = new CacheService(redis, new ObjectMapper());
    consumer = new CacheInvalidationConsumer(
      new StoreProperties(redisUrl, natsUrl),
      cache,
      new ObjectMapper()
    );

    try {
      publisherConnection = Nats.connect(natsUrl);
    } catch (IOException | InterruptedException failure) {
      throw new IllegalStateException(
        "Could not connect to NATS for this IT",
        failure
      );
    }
  }

  @AfterEach
  void disconnect() throws Exception {
    consumer.deactivate();
    if (publisherConnection != null) {
      publisherConnection.close();
    }
    connections.destroy();
  }

  @Test
  void activateSubscribesAndAnEventEvictsTheWarmedScope() {
    String tenant = "it-" + System.nanoTime();
    String key = cache.buildKey(tenant, "tickets", Map.of());
    cache.putRaw(key, "\"warm\"", 60);

    consumer.activate();
    publish("ticket.created", tenant);

    await()
      .atMost(Duration.ofSeconds(5))
      .untilAsserted(() -> assertThat(cache.raw(key)).isEmpty());
  }

  /**
   * "{@code activate()} returned" must mean "subscribed". The subscriptions are
   * queued on the connection, and an event published from ANOTHER connection the
   * instant {@code activate()} returns can reach the broker first — and core NATS
   * drops a message nobody is subscribed to yet. Once is a coin flip that
   * depends on load; repeated, it is a measurement.
   */
  @RepeatedTest(40)
  void anEventPublishedTheInstantActivateReturnsIsNeverLost() {
    String tenant = "it-" + System.nanoTime();
    String key = cache.buildKey(tenant, "tickets", Map.of());
    cache.putRaw(key, "\"warm\"", 60);

    consumer.activate();
    publish("ticket.created", tenant);

    await()
      .atMost(Duration.ofSeconds(2))
      .untilAsserted(() -> assertThat(cache.raw(key)).isEmpty());
  }

  @Test
  void deactivateActuallyStopsConsumption() {
    String tenant = "it-" + System.nanoTime();
    String key = cache.buildKey(tenant, "tickets", Map.of());

    consumer.activate();
    consumer.deactivate();

    cache.putRaw(key, "\"warm\"", 60);
    publish("ticket.created", tenant);

    // No assertion can prove a negative instantly — settle past the window
    // an active consumer would have evicted within, then confirm the key
    // survived. `awaitility`'s own idiom for "stayed true": poll, invert.
    await()
      .pollDelay(Duration.ofSeconds(2))
      .atMost(Duration.ofSeconds(3))
      .untilAsserted(() -> assertThat(cache.raw(key)).isPresent());
  }

  private void publish(String subject, String tenant) {
    String payload =
      "{\"pattern\":\"" +
      subject +
      "\",\"data\":{\"organizationId\":\"" +
      tenant +
      "\"}}";
    publisherConnection.publish(
      subject,
      payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)
    );
  }
}

package com.synapsedesk.gateway.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.config.SharedEnvironment;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * {@link CacheService#wrap} against the GraphQL analytics DTOs — the FIRST
 * Java records to flow through it. Everything {@code CacheService} has
 * cached so far ({@code AnalyticsController}'s REST DTOs) is an
 * OpenAPI-generated bean; this proves Jackson's record support (its own
 * `RecordComponent`-based creator, not the getter/setter path those beans
 * use) round-trips a nested record graph — a list of records inside a
 * record inside a record — byte-identical to what {@code produce} returned,
 * against a REAL Redis, same as {@link com.synapsedesk.gateway.cache.CacheServiceIT}.
 */
class AnalyticsCacheRoundTripIT {

  private StringRedisTemplate redis;
  private LettuceConnectionFactory connections;
  private CacheService cache;

  @BeforeEach
  void connect() {
    String url = SharedEnvironment.values().getOrDefault(
      "REDIS_URL",
      "redis://localhost:6379"
    );
    java.net.URI uri = java.net.URI.create(url);
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
  }

  @AfterEach
  void disconnect() {
    connections.destroy();
  }

  @Test
  void anOverviewSurvivesARealRedisRoundTrip() {
    AnalyticsOverviewGqlDto original = new AnalyticsOverviewGqlDto(
      10,
      8,
      2,
      5,
      new RateGqlDto(0.4, 4, 10),
      new RateGqlDto(null, 0, 0),
      new MeanGqlDto(120.5, 8),
      new MeanGqlDto(30.0, 8),
      new MeanGqlDto(600.0, 8),
      3600.0,
      OffsetDateTime.parse("2026-09-27T00:00:00Z"),
      "2026-09-26"
    );

    String key = "cache-test:" + System.nanoTime();
    AtomicInteger produced = new AtomicInteger();

    AnalyticsOverviewGqlDto first = cache.wrap(
      key,
      60,
      AnalyticsOverviewGqlDto.class,
      () -> {
        produced.incrementAndGet();
        return original;
      }
    );
    AnalyticsOverviewGqlDto second = cache.wrap(
      key,
      60,
      AnalyticsOverviewGqlDto.class,
      () -> {
        produced.incrementAndGet();
        return original;
      }
    );

    assertThat(first).isEqualTo(original);
    // The SECOND call read Redis rather than recomputing — proving the value
    // that survived the round trip, not just that `wrap` returns what it was
    // given the first time.
    assertThat(second).isEqualTo(original);
    assertThat(produced.get()).isEqualTo(1);
  }

  @Test
  void aNestedListOfRecordsSurvivesARealRedisRoundTrip() {
    AgentAnalyticsGqlDto original = new AgentAnalyticsGqlDto(
      List.of(
        new AgentStatGqlDto(
          "agent-1",
          5,
          4,
          12,
          new MeanGqlDto(200.0, 4),
          new RateGqlDto(0.75, 3, 4)
        ),
        new AgentStatGqlDto("agent-2", 2, 2, 6, new MeanGqlDto(null, 0), null)
      ),
      List.of(new UnavailableBlockGqlDto("ingestion-service", "unavailable")),
      "2026-09-26"
    );

    String key = "cache-test:" + System.nanoTime();
    cache.wrap(key, 60, AgentAnalyticsGqlDto.class, () -> original);

    AgentAnalyticsGqlDto readBack = cache.wrap(
      key,
      60,
      AgentAnalyticsGqlDto.class,
      () -> {
        throw new AssertionError(
          "should have read the cached value, not recomputed"
        );
      }
    );

    assertThat(readBack).isEqualTo(original);
  }
}

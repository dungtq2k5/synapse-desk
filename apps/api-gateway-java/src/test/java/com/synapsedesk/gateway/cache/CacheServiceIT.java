package com.synapsedesk.gateway.cache;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironment;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * The `cache:` keyspace, against a REAL Redis — plan 83 §8.
 *
 * <p>Neither gateway caches a real route yet (grep confirms Node's
 * `apps/api-gateway/src/modules/users` never calls `CacheService`/`cache.wrap`,
 * so plan 83's "GET /users/me, which is a cacheable route" is aspirational).
 * Wiring caching into just one side to make this row pass would be a worse
 * bug than the one it is meant to catch — the two implementations would then
 * answer a repeated request differently. So this proves the KEYSPACE is
 * shared without going through either gateway's HTTP surface: Java's real
 * {@link CacheService} on one side, Node's exact wire format (hand-written
 * here, since `encode`/`decode`/`DATE_TAG` in `cache.service.ts` are private
 * module functions, not exported) on the other.
 *
 * <p>An `IT`, connected the same way {@code GatewayLeaseIT} is: a real Redis
 * via `REDIS_URL`, started outside this process and outliving it — the
 * "containers outlive a gateway process" plan 83 §8 names is satisfied by not
 * needing a gateway process at all.
 */
class CacheServiceIT {

  private StringRedisTemplate redis;
  private LettuceConnectionFactory connections;
  private CacheService cache;

  @BeforeEach
  void connect() {
    String url = SharedEnvironment.values().getOrDefault("REDIS_URL", "redis://localhost:6379");
    java.net.URI uri = java.net.URI.create(url);
    var configuration =
        new RedisStandaloneConfiguration(
            uri.getHost() == null ? "localhost" : uri.getHost(), uri.getPort() < 0 ? 6379 : uri.getPort());
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
  void theKeyMatchesNodesBuildKeyFormula() {
    String key =
        cache.buildKey("11111111-1111-4111-8111-111111111111", "users:me", Map.of("b", "2", "a", "1"));

    // `cache:{org}|{scope}|{sorted params}` — sorted so `a=1&b=2` is the ONE
    // spelling, not two, matching `buildKey`'s own comment on why.
    assertThat(key).isEqualTo("cache:11111111-1111-4111-8111-111111111111|users:me|a=1&b=2");
  }

  @Test
  void aSuperAdminsTenantlessKeyUsesTheNoTenantLiteral() {
    assertThat(cache.buildKey(null, "roles", Map.of())).isEqualTo("cache:no-tenant|roles|");
  }

  @Test
  void javaWritesTheExactTaggedDateShapeNodeDecodesReading() {
    String key = "cache:it|" + getClass().getSimpleName() + "|" + System.nanoTime();
    OffsetDateTime computedAt = OffsetDateTime.of(2024, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    try {
      cache.wrap(key, 30, OffsetDateTime.class, () -> computedAt);

      // Node's `encode()`: `JSON.stringify(value, replacer)` with no spacing,
      // and `original.toISOString()` — always three fractional digits, `Z`.
      // A byte comparison, not a parse — the whole point of this row is that
      // NODE reading this exact string must not silently return `null`
      // (`GraphQLISODateTime.serialize()` on a bare string does that).
      assertThat(cache.raw(key)).contains("{\"__cache_date__\":\"2024-01-01T00:00:00.000Z\"}");
    } finally {
      redis.delete(key);
    }
  }

  @Test
  void javaDecodesNodesExactTaggedDateShapeWritingRaw() {
    String key = "cache:it|" + getClass().getSimpleName() + "|" + System.nanoTime();

    try {
      // What Node's `encode()` writes for `new Date('2024-06-15T12:30:00.000Z')` —
      // typed by hand from `cache.service.ts`, not produced by any Java code,
      // so this half of the round trip cannot pass by both sides sharing one bug.
      cache.putRaw(key, "{\"__cache_date__\":\"2024-06-15T12:30:00.000Z\"}", 30);

      OffsetDateTime decoded = cache.wrap(key, 30, OffsetDateTime.class, () -> {
        throw new AssertionError("a hit must not fall through to produce()");
      });

      assertThat(decoded).isEqualTo(OffsetDateTime.of(2024, 6, 15, 12, 30, 0, 0, ZoneOffset.UTC));
    } finally {
      redis.delete(key);
    }
  }
}

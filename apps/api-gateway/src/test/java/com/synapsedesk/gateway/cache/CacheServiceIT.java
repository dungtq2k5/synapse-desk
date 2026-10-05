package com.synapsedesk.gateway.cache;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironment;
import com.synapsedesk.gateway.sessions.RevokedCountDto;
import com.synapsedesk.gateway.web.ApiResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * The `cache:` keyspace, against a REAL Redis.
 *
 * <p>The gateway caches no real route yet, so "GET /users/me, which is a
 * cacheable route" is aspirational. So this proves the KEYSPACE without going
 * through the HTTP surface: the real {@link CacheService} on one side, and the
 * keyspace's exact wire format, hand-written here, on the other.
 *
 * <p>An `IT`, connected the same way {@code GatewayLeaseIT} is: a real Redis
 * via `REDIS_URL`, started outside this process and outliving it — the
 * "containers outlive a gateway process" requirement is satisfied by not
 * needing a gateway process at all.
 */
class CacheServiceIT {

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
  void theKeyMatchesNodesBuildKeyFormula() {
    String key = cache.buildKey(
      "11111111-1111-4111-8111-111111111111",
      "users:me",
      Map.of("b", "2", "a", "1")
    );

    // `cache:{org}|{scope}|{sorted params}` — sorted so `a=1&b=2` is the ONE
    // spelling, not two, matching `buildKey`'s own comment on why.
    assertThat(key).isEqualTo(
      "cache:11111111-1111-4111-8111-111111111111|users:me|a=1&b=2"
    );
  }

  @Test
  void aSuperAdminsTenantlessKeyUsesTheNoTenantLiteral() {
    assertThat(cache.buildKey(null, "roles", Map.of())).isEqualTo(
      "cache:no-tenant|roles|"
    );
  }

  @Test
  void javaWritesTheExactTaggedDateShapeNodeDecodesReading() {
    String key =
      "cache:it|" + getClass().getSimpleName() + "|" + System.nanoTime();
    OffsetDateTime computedAt = OffsetDateTime.of(
      2024,
      1,
      1,
      0,
      0,
      0,
      0,
      ZoneOffset.UTC
    );

    try {
      cache.wrap(key, 30, OffsetDateTime.class, () -> computedAt);

      // Node's `encode()`: `JSON.stringify(value, replacer)` with no spacing,
      // and `original.toISOString()` — always three fractional digits, `Z`.
      // A byte comparison, not a parse — the whole point of this row is that
      // NODE reading this exact string must not silently return `null`
      // (`GraphQLISODateTime.serialize()` on a bare string does that).
      assertThat(cache.raw(key)).contains(
        "{\"__cache_date__\":\"2024-01-01T00:00:00.000Z\"}"
      );
    } finally {
      redis.delete(key);
    }
  }

  @Test
  void invalidateScopeDropsOnlyTheMatchingTenantAndScope() {
    String tenant = "it-" + System.nanoTime();
    String otherTenant = "it-other-" + System.nanoTime();
    List<String> written = new java.util.ArrayList<>();

    try {
      written.add(cache.buildKey(tenant, "tickets", Map.of("page", "1")));
      written.add(cache.buildKey(tenant, "tickets", Map.of("page", "2")));
      written.add(cache.buildKey(tenant, "documents", Map.of()));
      written.add(cache.buildKey(otherTenant, "tickets", Map.of()));
      for (String key : written) {
        cache.putRaw(key, "\"value\"", 60);
      }

      int removed = cache.invalidateScope(tenant, "tickets");

      assertThat(removed).isEqualTo(2);
      assertThat(cache.raw(written.get(0))).isEmpty();
      assertThat(cache.raw(written.get(1))).isEmpty();
      assertThat(cache.raw(written.get(2))).isPresent();
      assertThat(cache.raw(written.get(3))).isPresent();
    } finally {
      redis.delete(written);
    }
  }

  @Test
  void invalidateScopeDoesNotDropADifferentlyNamedScopeSharingAPrefix() {
    String tenant = "it-prefix-" + System.nanoTime();
    List<String> written = new java.util.ArrayList<>();

    try {
      // `analytics` vs `analytics-graphql`-shaped collision, the reason the
      // pattern's `[|:]` character class exists.
      written.add(cache.buildKey(tenant, "tickets", Map.of()));
      written.add(cache.buildKey(tenant, "ticketsExtended", Map.of()));
      for (String key : written) {
        cache.putRaw(key, "\"value\"", 60);
      }

      cache.invalidateScope(tenant, "tickets");

      assertThat(cache.raw(written.get(0))).isEmpty();
      assertThat(cache.raw(written.get(1))).isPresent();
    } finally {
      redis.delete(written);
    }
  }

  @Test
  void javaDecodesNodesExactTaggedDateShapeWritingRaw() {
    String key =
      "cache:it|" + getClass().getSimpleName() + "|" + System.nanoTime();

    try {
      // What Node's `encode()` writes for `new Date('2024-06-15T12:30:00.000Z')` —
      // typed by hand from `cache.service.ts`, not produced by any Java code,
      // so this half of the round trip cannot pass by both sides sharing one bug.
      cache.putRaw(
        key,
        "{\"__cache_date__\":\"2024-06-15T12:30:00.000Z\"}",
        30
      );

      OffsetDateTime decoded = cache.wrap(key, 30, OffsetDateTime.class, () -> {
        throw new AssertionError("a hit must not fall through to produce()");
      });

      assertThat(decoded).isEqualTo(
        OffsetDateTime.of(2024, 6, 15, 12, 30, 0, 0, ZoneOffset.UTC)
      );
    } finally {
      redis.delete(key);
    }
  }

  /**
   * `wrapTyped`'s own reason to exist, proven on a real cache HIT rather
   * than assumed. Measured the hard way on `RolesController.list`: {@code
   * wrap(key, ttl, ApiResponse.class, ...)} compiles — {@code Class<T>}
   * accepts the raw type — but a HIT then deserializes `data` as an
   * untyped {@code LinkedHashMap}, not a {@link RevokedCountDto}, because
   * `Class<ApiResponse>` erases the `<RevokedCountDto>` argument before
   * Jackson ever sees it. No mocked unit test catches this: a mock's
   * `wrap`/`wrapTyped` stub just invokes the supplier and returns whatever
   * it built, never round-tripping through JSON at all. Only a real Redis
   * HIT — bytes in, bytes back out — exercises the deserialization path
   * where the bug actually lives.
   */
  @Test
  void wrapTypedSurvivesAGenericRoundTripOnARealCacheHit() {
    String key =
      "cache:it|" + getClass().getSimpleName() + "|" + System.nanoTime();

    try {
      ApiResponse<RevokedCountDto> written = ApiResponse.of(
        200,
        "OK",
        new RevokedCountDto(3)
      );
      cache.wrapTyped(
        key,
        30,
        new TypeReference<ApiResponse<RevokedCountDto>>() {},
        () -> written
      );

      ApiResponse<RevokedCountDto> hit = cache.wrapTyped(
        key,
        30,
        new TypeReference<ApiResponse<RevokedCountDto>>() {},
        () -> {
          throw new AssertionError("a hit must not fall through to produce()");
        }
      );

      // The assertion that actually fails on the bug: `data()` typed as
      // `RevokedCountDto` and its field readable directly, not a map needing
      // `.get("revokedCount")`.
      assertThat(hit.data().revokedCount()).isEqualTo(3);
    } finally {
      redis.delete(key);
    }
  }
}

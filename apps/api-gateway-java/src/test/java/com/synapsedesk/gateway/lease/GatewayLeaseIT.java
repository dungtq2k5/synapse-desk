package com.synapsedesk.gateway.lease;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironment;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * The implementation lease, against a REAL Redis.
 *
 * <p><b>An `IT`, not a `Test`.</b> The claim is a Lua script and the point is
 * that it is ATOMIC; a fake that "ran" it would be a reimplementation of
 * Redis, which is the one thing this must not be tested against. So these run
 * under failsafe, in `verify`, and `./mvnw test` stays runnable with nothing
 * started — the same split the Node side has between `npm test` and
 * `npm run test:e2e:gateway`.
 *
 * <p>The rows mirror the Node suite's, from the other side: there, a foreign
 * `gateway:holders:java` entry kept Node standing by. Here a
 * `gateway:holders:node` entry keeps JAVA standing by, and that symmetry is
 * the exclusion — each half proves it refuses to serve while the other is
 * live.
 */
class GatewayLeaseIT {

  private StringRedisTemplate redis;
  private LettuceConnectionFactory connections;
  private final List<GatewayLeaseService> leases = new java.util.ArrayList<>();

  /** What the runtime was told to do, in order. */
  private static final class Recorder implements LeaseRuntime {
    final List<String> events = new java.util.ArrayList<>();

    @Override
    public void activate() {
      events.add("activate");
    }

    @Override
    public void deactivate() {
      events.add("deactivate");
    }
  }

  @BeforeEach
  void connect() {
    String url = SharedEnvironment.values().getOrDefault("REDIS_URL", "redis://localhost:6379");
    connections =
        new LettuceConnectionFactory(
            org.springframework.data.redis.connection.RedisConfiguration.class.cast(
                    redisStandalone(url))
                .getClass()
                .cast(redisStandalone(url)));
    connections.afterPropertiesSet();
    redis = new StringRedisTemplate(connections);

    redis.delete(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION));
    redis.delete(GatewayLease.holdersKey(GatewayLease.OTHER));
  }

  private static org.springframework.data.redis.connection.RedisStandaloneConfiguration
      redisStandalone(String url) {
    java.net.URI uri = java.net.URI.create(url);
    var configuration =
        new org.springframework.data.redis.connection.RedisStandaloneConfiguration(
            uri.getHost() == null ? "localhost" : uri.getHost(),
            uri.getPort() < 0 ? 6379 : uri.getPort());

    String path = uri.getPath();
    if (path != null && path.length() > 1) {
      configuration.setDatabase(Integer.parseInt(path.substring(1)));
    }

    return configuration;
  }

  @AfterEach
  void stop() {
    for (GatewayLeaseService lease : leases) {
      lease.onShutdown();
    }
    leases.clear();
    redis.delete(GatewayLease.holdersKey(GatewayLease.IMPLEMENTATION));
    redis.delete(GatewayLease.holdersKey(GatewayLease.OTHER));
    connections.destroy();
  }

  /** A lease driven by hand — `beat()` rather than its own timer. */
  private GatewayLeaseService lease(Recorder runtime) {
    GatewayLeaseService service = new GatewayLeaseService(redis, runtime);
    leases.add(service);

    return service;
  }

  @Test
  void twoJavaReplicasBothServe() {
    // The exclusion is between IMPLEMENTATIONS, not between processes:
    // production runs `replicas: 2`, and both must serve.
    Recorder first = new Recorder();
    Recorder second = new Recorder();
    lease(first).beat();
    lease(second).beat();

    assertThat(first.events).containsExactly("activate");
    assertThat(second.events).containsExactly("activate");
    assertThat(redis.opsForZSet().size(GatewayLease.holdersKey("java"))).isEqualTo(2);
  }

  @Test
  void aLiveNodeEntryKeepsJavaAStandby() {
    // What a Node pod writes — the mirror of the Node suite's fake `java`
    // entry. This is check 5 at the Redis level; `NodeAndJavaIT` runs the
    // real Node gateway beside this one.
    redis.opsForZSet()
        .add(
            GatewayLease.holdersKey("node"),
            "node-pod-1:7:abcdef12",
            System.currentTimeMillis() + GatewayLease.TTL.toMillis());

    Recorder java = new Recorder();
    GatewayLeaseService lease = lease(java);
    lease.beat();

    assertThat(lease.isActive()).isFalse();
    // Never started, rather than started and stopped: a standby that briefly
    // consumed would have relayed frames the other implementation also
    // relayed.
    assertThat(java.events).isEmpty();
    assertThat(redis.opsForZSet().size(GatewayLease.holdersKey("java"))).isZero();
  }

  @Test
  void anExpiredNodeEntryDoesNotKeepJavaStandingBy() {
    // The pruning half. Without it a Node pod that was SIGKILLed — no
    // shutdown hook, so no ZREM — would hold the Java side down until
    // something else removed its entry.
    redis.opsForZSet()
        .add(GatewayLease.holdersKey("node"), "node-gone:7:00", System.currentTimeMillis() - 1);

    Recorder java = new Recorder();
    GatewayLeaseService lease = lease(java);
    lease.beat();

    assertThat(lease.isActive()).isTrue();
    assertThat(redis.opsForZSet().size(GatewayLease.holdersKey("node"))).isZero();
  }

  @Test
  void shutdownReleasesTheEntrySoTheOtherSideMayClaimAtOnce() {
    Recorder java = new Recorder();
    GatewayLeaseService lease = lease(java);
    lease.beat();
    assertThat(redis.opsForZSet().size(GatewayLease.holdersKey("java"))).isEqualTo(1);

    lease.onShutdown();
    leases.clear();

    assertThat(java.events).containsExactly("activate", "deactivate");
    assertThat(redis.opsForZSet().size(GatewayLease.holdersKey("java"))).isZero();
  }

  @Test
  void aHolderWhoseEntryVanishedStepsDownOnTheNextBeat() {
    Recorder java = new Recorder();
    GatewayLeaseService lease = lease(java);
    lease.beat();

    // What a pause past the TTL looks like from Redis's side. The refresh is
    // compare-and-extend for exactly this: a plain ZADD would put this
    // process back beside whoever claimed in the meantime.
    redis.delete(GatewayLease.holdersKey("java"));
    lease.beat();

    assertThat(lease.isActive()).isFalse();
    assertThat(java.events).containsExactly("activate", "deactivate");
  }

  @Test
  void aBeatWhileHoldingExtendsRatherThanReAdds() {
    Recorder java = new Recorder();
    GatewayLeaseService lease = lease(java);
    lease.beat();
    var before = redis.opsForZSet().range(GatewayLease.holdersKey("java"), 0, -1);

    lease.beat();

    assertThat(redis.opsForZSet().range(GatewayLease.holdersKey("java"), 0, -1))
        .isEqualTo(before);
    assertThat(lease.isActive()).isTrue();
    assertThat(java.events).containsExactly("activate");
  }
}

package com.synapsedesk.gateway.lease;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Both implementations, at once — check 5, and the first time the claim script
 * is exercised from the far side.
 *
 * <p>The REAL Node gateway process holds the lease; this JVM's lease then
 * stands by. Every other row about the lease writes the other side's entry by
 * hand, which proves the script and not the pairing: only running the Node
 * gateway proves that what it writes is what this one reads — the same key,
 * the same member format, the same TTL units.
 *
 * <p><b>It fails loudly rather than skipping.</b> A two-process row that
 * quietly skips when the Node build is missing is a row that stops testing the
 * thing it exists for and says nothing. The message names the build command.
 */
class NodeAndJavaIT {

  private static final Path NODE_MAIN =
      Path.of("../api-gateway/dist/apps/api-gateway/src/main.js");

  private StringRedisTemplate redis;
  private LettuceConnectionFactory connections;
  private Process node;

  @BeforeEach
  void connect() throws Exception {
    // **The SAME `REDIS_URL` the Node process is given — including the
    // DATABASE.** Measured the hard way: `.env.test` says
    // `redis://localhost:6379/15` and `.env.example` says no database at all,
    // so a first version of this row had the two gateways on db 15 and db 0.
    // Both claimed, neither saw the other, and the row failed as "Node never
    // claimed" — which was true of the database Java was watching. The lease
    // excludes only within one keyspace, and nothing in the system checks
    // that the two implementations share one.
    String url =
        nodeEnvironment().getOrDefault("REDIS_URL", "redis://localhost:6379");
    java.net.URI uri = java.net.URI.create(url);
    RedisStandaloneConfiguration configuration =
        new RedisStandaloneConfiguration(
            uri.getHost() == null ? "localhost" : uri.getHost(),
            uri.getPort() < 0 ? 6379 : uri.getPort());

    if (uri.getPath() != null && uri.getPath().length() > 1) {
      configuration.setDatabase(Integer.parseInt(uri.getPath().substring(1)));
    }

    connections = new LettuceConnectionFactory(configuration);
    connections.afterPropertiesSet();
    redis = new StringRedisTemplate(connections);
    redis.delete(GatewayLease.holdersKey("node"));
    redis.delete(GatewayLease.holdersKey("java"));
  }

  @AfterEach
  void stopNode() {
    if (node != null && node.isAlive()) {
      node.destroy();
      try {
        node.waitFor(20, java.util.concurrent.TimeUnit.SECONDS);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
    }

    redis.delete(GatewayLease.holdersKey("node"));
    redis.delete(GatewayLease.holdersKey("java"));
    connections.destroy();
  }

  @Test
  void javaStandsByWhileTheRealNodeGatewayHoldsTheLease() throws Exception {
    startNodeGateway();

    // The Node gateway's own entry, written by its own lease — not a fixture.
    waitFor(() -> size("node") == 1, "the Node gateway to claim the lease");

    GatewayLeaseService java =
        new GatewayLeaseService(
            redis,
            new LeaseRuntime() {
              @Override
              public void activate() {
                throw new AssertionError("Java activated while Node held the lease");
              }

              @Override
              public void deactivate() {
                // unreachable while the row passes
              }
            });

    java.beat();

    assertThat(java.isActive()).isFalse();
    assertThat(size("java")).isZero();
  }

  @Test
  void javaClaimsOnceTheNodeGatewayHasStoppedAndReleased() throws Exception {
    startNodeGateway();
    waitFor(() -> size("node") == 1, "the Node gateway to claim the lease");

    // A CLEAN stop, which is the switch the rehearsal performs: the Node
    // gateway releases its entry on shutdown, so the handover costs one poll
    // rather than the whole TTL.
    node.destroy();
    waitFor(() -> size("node") == 0, "the Node gateway to release its entry");

    GatewayLeaseService java = new GatewayLeaseService(redis, new NoopRuntime());
    java.beat();

    assertThat(java.isActive()).isTrue();
    java.onShutdown();
  }

  private static final class NoopRuntime implements LeaseRuntime {
    @Override
    public void activate() {}

    @Override
    public void deactivate() {}
  }

  /** The built Node gateway, on the shared test environment. */
  private void startNodeGateway() throws Exception {
    if (!Files.exists(NODE_MAIN)) {
      throw new AssertionError(
          NODE_MAIN.toAbsolutePath()
              + " is absent. Build it: npx turbo run build --filter=@synapsedesk/api-gateway...");
    }

    Map<String, String> environment = new HashMap<>(nodeEnvironment());
    ProcessBuilder builder =
        new ProcessBuilder("node", "apps/api-gateway/dist/apps/api-gateway/src/main.js")
            .directory(new File("../.."))
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.to(new File("target/node-gateway.log")));
    builder.environment().putAll(environment);

    node = builder.start();
  }

  /**
   * The Node gateway's own `.env.test`, which is where its key paths and its
   * port come from — and they are RELATIVE to the repository root, which is
   * why the process is started there.
   */
  private Map<String, String> nodeEnvironment() throws Exception {
    Map<String, String> values = new HashMap<>();

    for (String line : Files.readAllLines(Path.of("../api-gateway/.env.test"))) {
      java.util.regex.Matcher matcher =
          java.util.regex.Pattern.compile("^\\s*([A-Z][A-Z0-9_]*)\\s*=\\s*(.*?)\\s*$")
              .matcher(line);

      if (matcher.matches()) {
        String value = matcher.group(2);
        if (value.length() >= 2
            && ((value.startsWith("'") && value.endsWith("'"))
                || (value.startsWith("\"") && value.endsWith("\"")))) {
          value = value.substring(1, value.length() - 1);
        }
        values.put(matcher.group(1), value);
      }
    }

    // A port of its own: this row cares about the lease, not about serving,
    // and a collision with a developer's running gateway would read as the
    // Node side failing to claim.
    values.put("PORT", "3178");
    values.put("METRICS_PORT", "9478");

    return values;
  }

  private long size(String implementation) {
    Long size = redis.opsForZSet().size(GatewayLease.holdersKey(implementation));

    return size == null ? 0 : size;
  }

  private void waitFor(java.util.function.BooleanSupplier condition, String what)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + 60_000;

    while (System.currentTimeMillis() < deadline) {
      if (condition.getAsBoolean()) {
        return;
      }
      Thread.sleep(250);
    }

    throw new AssertionError("Timed out waiting for " + what);
  }
}

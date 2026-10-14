package com.synapsedesk.gateway.modules.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.synapsedesk.gateway.GatewayApplication;
import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.common.config.SharedEnvironment;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * A Redis outage costs the gateway nothing but Redis: it boots, it is ready, and
 * its routes answer at once — with Redis down from the start, and with Redis lost
 * after boot.
 *
 * <p>Redis is reached through {@link Cut}, a proxy this test can sever, in front of
 * the real Redis from {@code REDIS_URL}. Each row boots its own gateway and closes
 * it, rather than a cached {@code @SpringBootTest} context, because each needs its
 * own {@code REDIS_URL}.
 *
 * <p>Every request is bounded at {@link #PROMPT}: the failure this guards against
 * held each request for the Redis client's whole command timeout (60 s by default),
 * so the bound is about that, not about speed.
 */
class RedisOutageIT {

  private static final Duration PROMPT = Duration.ofSeconds(10);

  @Test
  void aGatewayBootedWithRedisDownIsReadyAndServes() throws Exception {
    try (Cut redis = Cut.toRealRedis()) {
      redis.sever();

      try (ConfigurableApplicationContext gateway = boot(redis.url())) {
        int port = portOf(gateway);

        assertReadyWithRedis(port, "DOWN");
        assertARouteAnswers(port);
      }
    }
  }

  @Test
  void aGatewayThatLosesRedisStaysReadyAndServes() throws Exception {
    try (Cut redis = Cut.toRealRedis()) {
      try (ConfigurableApplicationContext gateway = boot(redis.url())) {
        int port = portOf(gateway);
        assertReadyWithRedis(port, "UP");
        assertARouteAnswers(port);

        redis.sever();

        assertReadyWithRedis(port, "DOWN");
        assertARouteAnswers(port);
        assertARouteAnswers(port);
      }
    }
  }

  /**
   * A revoked session's token is refused while Redis answers, and accepted
   * once it can't, with a warning: the check fails open, and the token's own
   * expiry is the backstop.
   */
  @Test
  void aRevokedSessionIsRefusedWithRedisAndAcceptedWithoutIt()
    throws Exception {
    String sid = java.util.UUID.randomUUID().toString();
    String cookie = "access_token=" + accessToken(sid);

    try (Cut redis = Cut.toRealRedis()) {
      try (
        ConfigurableApplicationContext gateway = boot(
          redis.url(),
          Map.of(
            "JWT_ACCESS_PUBLIC_KEY_PATH",
            TEST_KEYS + "jwt-access.test.pub"
          )
        )
      ) {
        int port = portOf(gateway);
        // Attached after boot: Spring Boot resets logging as it starts.
        ch.qos.logback.classic.Logger logger =
          (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
            com.synapsedesk.gateway.common.auth.RevokedSessions.class
          );
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> logged =
          new ch.qos.logback.core.read.ListAppender<>();
        logged.start();
        logger.addAppender(logged);
        // Tests run with logging off; this row reads a warning.
        ch.qos.logback.classic.Level level = logger.getLevel();
        logger.setLevel(ch.qos.logback.classic.Level.WARN);
        gateway
          .getBean(
            org.springframework.data.redis.core.StringRedisTemplate.class
          )
          .opsForValue()
          .set(
            com.synapsedesk.gateway.common.contracts.SessionKeys.REVOKED_SESSION_KEY_PREFIX +
              sid,
            "1",
            Duration.ofMinutes(1)
          );

        assertThat(sessions(port, cookie).status()).isEqualTo(401);

        redis.sever();

        // Past authentication: auth-service isn't running here, so not a 401.
        assertThat(sessions(port, cookie).status()).isNotEqualTo(401);
        assertThat(logged.list)
          .extracting(
            ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage
          )
          .anyMatch(message ->
            message.startsWith("Couldn't read whether session " + sid)
          );
        logger.detachAppender(logged);
        logger.setLevel(level);
      }
    }
  }

  private static final String TEST_KEYS = "../../test/fixtures/keys/";

  private static HttpProbe sessions(int port, String cookie) {
    return prompt(() ->
      HttpProbe.get(port, "/api/v1/auth/sessions", Map.of("Cookie", cookie))
    );
  }

  /** An access token for session family {@code sid}, signed with the test key. */
  private static String accessToken(String sid) throws Exception {
    String pem = java.nio.file.Files.readString(
      java.nio.file.Path.of(TEST_KEYS + "jwt-access.test.key")
    )
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replaceAll("\\s", "");
    java.security.PrivateKey key = java.security.KeyFactory.getInstance(
      "RSA"
    ).generatePrivate(
      new java.security.spec.PKCS8EncodedKeySpec(
        java.util.Base64.getDecoder().decode(pem)
      )
    );
    com.nimbusds.jwt.SignedJWT jwt = new com.nimbusds.jwt.SignedJWT(
      new com.nimbusds.jose.JWSHeader(com.nimbusds.jose.JWSAlgorithm.RS256),
      new com.nimbusds.jwt.JWTClaimsSet.Builder()
        .subject("aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa")
        .claim("organizationId", "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa")
        .claim("isSuperAdmin", false)
        .claim("departmentIds", List.of())
        .claim("permissionCodes", List.of())
        .claim("isEmailVerified", true)
        .claim("sid", sid)
        .expirationTime(
          new java.util.Date(System.currentTimeMillis() + 900_000)
        )
        .build()
    );
    jwt.sign(new com.nimbusds.jose.crypto.RSASSASigner(key));
    return jwt.serialize();
  }

  private static void assertReadyWithRedis(int port, String redis) {
    HttpProbe ready = prompt(() -> HttpProbe.get(port, "/health/ready"));

    assertThat(ready.status()).isEqualTo(200);
    assertThat(ready.data()).containsEntry("ready", true);
    assertThat(ready.data().get("dependencies")).isEqualTo(
      Map.of("redis", redis)
    );
  }

  /** A route behind the rate limiter, which touches Redis on every request. */
  private static void assertARouteAnswers(int port) {
    assertThat(
      prompt(() -> HttpProbe.get(port, "/api/v1/tickets")).status()
    ).isEqualTo(401);
  }

  private static <T> T prompt(Supplier<T> request) {
    return assertTimeoutPreemptively(PROMPT, request::get);
  }

  private static ConfigurableApplicationContext boot(String redisUrl) {
    return boot(redisUrl, Map.of());
  }

  private static ConfigurableApplicationContext boot(
    String redisUrl,
    Map<String, Object> overrides
  ) {
    Map<String, Object> properties = new HashMap<>(SharedEnvironment.values());
    properties.putAll(overrides);
    properties.put("REDIS_URL", redisUrl);
    properties.put("server.port", "0");
    properties.put("management.server.port", "0");
    properties.put("realtime.port", "0");

    return new SpringApplicationBuilder(GatewayApplication.class)
      .properties(properties)
      .run();
  }

  private static int portOf(ConfigurableApplicationContext context) {
    return ((WebServerApplicationContext) context).getWebServer().getPort();
  }

  /** A TCP proxy to Redis that {@link #sever} closes, connections and listener. */
  private static final class Cut implements AutoCloseable {

    private final ServerSocket listener = new ServerSocket();
    private final List<Socket> open = new CopyOnWriteArrayList<>();
    private final InetSocketAddress target;
    private volatile boolean severed;

    private Cut(InetSocketAddress target) throws IOException {
      this.target = target;
      listener.bind(new InetSocketAddress("127.0.0.1", 0));
      Thread accept = new Thread(this::accept, "redis-cut");
      accept.setDaemon(true);
      accept.start();
    }

    static Cut toRealRedis() throws IOException {
      URI real = URI.create(SharedEnvironment.values().get("REDIS_URL"));

      return new Cut(new InetSocketAddress(real.getHost(), real.getPort()));
    }

    String url() {
      return "redis://127.0.0.1:" + listener.getLocalPort();
    }

    private void accept() {
      while (!listener.isClosed()) {
        try {
          Socket client = listener.accept();
          if (severed) {
            client.close();
            continue;
          }
          Socket server = new Socket(target.getHostString(), target.getPort());
          open.add(client);
          open.add(server);
          pipe(client, server);
          pipe(server, client);
        } catch (IOException closed) {
          return;
        }
      }
    }

    private void pipe(Socket from, Socket to) {
      Thread thread = new Thread(() -> {
        try (InputStream in = from.getInputStream()) {
          OutputStream out = to.getOutputStream();
          in.transferTo(out);
        } catch (IOException ignored) {
          // severed
        }
      }, "redis-cut-pipe");
      thread.setDaemon(true);
      thread.start();
    }

    /** Every connection dropped and every new one refused, as when Redis dies. */
    void sever() throws IOException {
      severed = true;
      for (Socket socket : open) socket.close();
      open.clear();
    }

    @Override
    public void close() throws IOException {
      sever();
      listener.close();
    }
  }
}

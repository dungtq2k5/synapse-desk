package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.synapsedesk.gateway.common.config.InboundEmailProperties;
import com.synapsedesk.gateway.inbound.ResendInboundClient.Failure;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Resend client against a real HTTP server, so what is exercised is the wire:
 * the credential it sends, the status it reads, and a connection that dies.
 *
 * <p>The classification is the safety property of the whole webhook: a retryable
 * failure must be the ONLY non-2xx, because a 200 on a transient one loses the
 * mail and a 503 on a permanent one makes Resend retry for hours to no effect.
 */
class ResendInboundClientTest {

  private static final String MAIL = "11111111-1111-4111-8111-111111111111";

  private HttpServer server;
  private ResendInboundClient client;
  private final List<String> seen = new CopyOnWriteArrayList<>();
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private volatile Reply reply = new Reply(
    200,
    "{}",
    "application/json",
    false
  );

  private record Reply(int status, String body, String type, boolean drop) {}

  @BeforeEach
  void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::answer);
    server.start();
    client = new ResendInboundClient(
      new InboundEmailProperties(
        "s",
        "inbound.test",
        "support@test",
        "whsec_x",
        "re_wire_key",
        "http://127.0.0.1:" + server.getAddress().getPort() + "/"
      ),
      JsonMapper.builder().build()
    );
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  private void answer(HttpExchange exchange) throws IOException {
    seen.add(
      exchange.getRequestMethod() +
        " " +
        exchange.getRequestURI().getRawPath() +
        (exchange.getRequestURI().getRawQuery() == null
          ? ""
          : "?" + exchange.getRequestURI().getRawQuery())
    );
    authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
    Reply now = reply;
    if (now.drop()) {
      exchange.getRequestBody().readAllBytes();
      exchange.close();
      // Closing without writing a response line is a connection that died.
      return;
    }
    byte[] body = now.body().getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", now.type());
    exchange.sendResponseHeaders(
      now.status(),
      body.length == 0 ? -1 : body.length
    );
    if (body.length > 0) exchange.getResponseBody().write(body);
    exchange.close();
  }

  private void programme(int status, String body) {
    reply = new Reply(status, body, "application/json", false);
  }

  @Test
  void aMailIsReadWithTheCredentialAndFromTheEnvelopeFields() {
    programme(
      200,
      """
      {"from":"a@b.test","subject":"Hi","text":"body","message_id":"<m@x>","received_for":["x@inbound.test"],"headers":{"Message-ID":"<m@x>"},"attachments":[],"unknown":1}
      """
    );

    var result = client.getEmail(MAIL);

    assertThat(result.failure()).isNull();
    assertThat(result.data().subject()).isEqualTo("Hi");
    assertThat(result.data().receivedFor()).containsExactly("x@inbound.test");
    assertThat(seen).containsExactly("GET /emails/receiving/" + MAIL);
    assertThat(authorization.get()).isEqualTo("Bearer re_wire_key");
  }

  @Test
  void theAttachmentListAsksForThePageMaximum() {
    programme(
      200,
      """
      {"object":"list","has_more":true,"data":[{"id":"a1","download_url":"https://x.test/a","expires_at":"2030-01-01T00:00:00.000Z"}]}
      """
    );

    var result = client.listAttachments(MAIL);

    assertThat(result.data().hasMore()).isTrue();
    assertThat(result.data().data().get(0).id()).isEqualTo("a1");
    assertThat(seen).containsExactly(
      "GET /emails/receiving/" + MAIL + "/attachments?limit=100"
    );
  }

  @ParameterizedTest(name = "a {0} is retryable")
  @CsvSource({
    "429,rate_limit_exceeded",
    "500,internal_server_error",
    "503,application_error",
    "502,bad_gateway",
  })
  void retryableStatusesAreRetryable(int status, String name) {
    programme(status, "{\"name\":\"" + name + "\",\"message\":\"later\"}");

    Failure failure = client.getEmail(MAIL).failure();

    assertThat(failure.statusCode()).isEqualTo(status);
    assertThat(failure.name()).isEqualTo(name);
    assertThat(failure.retryable()).isTrue();
  }

  @ParameterizedTest(name = "a {0} is NOT retryable")
  @CsvSource({
    "404,not_found",
    "401,restricted_api_key",
    "403,forbidden",
    "422,x",
  })
  void permanentStatusesAreNot(int status, String name) {
    programme(status, "{\"name\":\"" + name + "\",\"message\":\"no\"}");

    assertThat(client.getEmail(MAIL).failure().retryable()).isFalse();
  }

  @Test
  void aProxysHtmlErrorPageIsClassifiedByItsStatusAndHasNoVendorName() {
    reply = new Reply(403, "<html>Forbidden</html>", "text/html", false);

    Failure failure = client.getEmail(MAIL).failure();

    assertThat(failure.statusCode()).isEqualTo(403);
    assertThat(failure.name()).isEqualTo("application_error");
    assertThat(failure.retryable()).isFalse();
  }

  @Test
  void aProxysHtmlBadGatewayIsRetryable() {
    reply = new Reply(502, "<html>Bad Gateway</html>", "text/html", false);

    assertThat(client.getEmail(MAIL).failure().retryable()).isTrue();
  }

  @Test
  void aConcurrentIdempotencyConflictIsRetryableDespiteItsStatus() {
    programme(409, "{\"name\":\"concurrent_idempotent_requests\"}");

    assertThat(client.getEmail(MAIL).failure().retryable()).isTrue();
  }

  @Test
  void aConnectionThatDiesWithNoAnswerIsRetryableAndHasNoStatus() {
    reply = new Reply(0, "", "text/plain", true);

    Failure failure = client.getEmail(MAIL).failure();

    assertThat(failure.statusCode()).isNull();
    assertThat(failure.name()).isEqualTo("application_error");
    assertThat(failure.retryable()).isTrue();
    // One attempt: a retry is Resend's job (it redelivers), and a hidden second
    // call is one more against the account's rate limit.
    assertThat(seen).hasSize(1);
  }

  @Test
  void nothingListeningIsRetryableToo() {
    server.stop(0);

    assertThat(client.getEmail(MAIL).failure().retryable()).isTrue();
  }

  @Test
  void anUnreadableSuccessBodyIsAFailureNotAMail() {
    programme(200, "not json at all");

    Failure failure = client.getEmail(MAIL).failure();

    assertThat(failure).isNotNull();
    assertThat(failure.retryable()).isFalse();
  }

  @Test
  void anIdIsEncodedAsASinglePathSegment() {
    programme(404, "{\"name\":\"not_found\"}");

    client.getEmail("a/b c?d");

    assertThat(seen).containsExactly("GET /emails/receiving/a%2Fb%20c%3Fd");
  }
}

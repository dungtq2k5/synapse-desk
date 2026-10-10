package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.inbound.InboundEmailService.AcceptOptions;
import com.synapsedesk.gateway.inbound.InboundEmailService.RemoteAttachmentSource;
import com.synapsedesk.gateway.inbound.ResendInboundClient.Failure;
import com.synapsedesk.gateway.inbound.ResendInboundClient.Result;
import com.synapsedesk.gateway.inbound.ResendPayloads.AttachmentList;
import com.synapsedesk.gateway.inbound.ResendPayloads.AttachmentSource;
import com.synapsedesk.gateway.inbound.ResendPayloads.Email;
import com.synapsedesk.gateway.metrics.GatewayMetrics;
import com.synapsedesk.gateway.webhooks.ResendWebhookAcknowledgementDto;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.validation.Validation;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Every exit of the Resend webhook, and what each one counts.
 *
 * <p>The signature is the ONLY thing standing between an unauthenticated caller
 * and this route doing anything at all, so the rows sign a request with their own
 * signer — the same algorithm as {@code test/gateway-contract/standard-webhooks.ts},
 * deliberately not the production class's, so a broken verifier cannot agree with
 * itself.
 *
 * <p>Every row asserts the COUNTER too: "exactly once" is two claims — the
 * expected label rises by one, and nothing else moves — and a 503 for the right
 * reason and a 503 because nothing was attempted look identical from outside.
 */
class ResendInboundServiceTest {

  private static final String SECRET =
    "whsec_" +
    Base64.getEncoder().encodeToString(
      "a-test-secret-32-bytes-long!!!!".getBytes(StandardCharsets.UTF_8)
    );
  private static final String EMAIL_ID = "11111111-1111-4111-8111-111111111111";
  private static final String TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

  private ResendInboundClient client;
  private InboundEmailService inbound;
  private MeterRegistry registry;
  private ResendInboundService service;

  @BeforeEach
  void setUp() {
    client = mock(ResendInboundClient.class);
    inbound = mock(InboundEmailService.class);
    registry = new SimpleMeterRegistry();
    service = new ResendInboundService(
      client,
      inbound,
      new GatewayMetrics(registry),
      Validation.buildDefaultValidatorFactory().getValidator(),
      new InboundEmailProperties(
        "shared-secret",
        "inbound.test",
        "support@synapsedesk.test",
        SECRET,
        "re_key",
        "https://api.resend.test"
      ),
      JsonMapper.builder().build()
    );
  }

  // ------------------------------------------------------------- helpers

  private static Map<String, String> sign(
    String body,
    long timestamp,
    String secret
  ) {
    String id = "msg_" + UUID.randomUUID();
    byte[] key = Base64.getDecoder().decode(secret.replaceFirst("^whsec_", ""));
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      String digest = Base64.getEncoder().encodeToString(
        mac.doFinal(
          (id + "." + timestamp + "." + body).getBytes(StandardCharsets.UTF_8)
        )
      );

      return Map.of(
        "svix-id",
        id,
        "svix-timestamp",
        String.valueOf(timestamp),
        "svix-signature",
        "v1," + digest
      );
    } catch (NoSuchAlgorithmException | InvalidKeyException failure) {
      throw new IllegalStateException(failure);
    }
  }

  private static long now() {
    return Instant.now().getEpochSecond();
  }

  private static String event(String type) {
    return (
      "{\"type\":\"" +
      type +
      "\",\"created_at\":\"2026-10-01T09:00:00.000Z\"," +
      "\"data\":{\"email_id\":\"" +
      EMAIL_ID +
      "\",\"received_for\":[\"support+" +
      TOKEN +
      "@inbound.test\"]}}"
    );
  }

  private ResendWebhookAcknowledgementDto deliver(String body) {
    return service.handle(
      body.getBytes(StandardCharsets.UTF_8),
      sign(body, now(), SECRET)::get
    );
  }

  private static Email mail(String from) {
    return new Email(
      from,
      "Help",
      "Please help",
      null,
      "<m@acme.test>",
      List.of("support+" + TOKEN + "@inbound.test"),
      Map.of(),
      List.of()
    );
  }

  /** What rose, by label: the counter is read as a whole so a stray increment shows. */
  private Map<String, Double> counted() {
    Map<String, Double> all = new HashMap<>();
    registry
      .find("inbound_email_webhook_total")
      .counters()
      .forEach(counter ->
        all.put(counter.getId().getTag("outcome"), counter.count())
      );

    return all;
  }

  private void assertRejected(
    Runnable delivery,
    String outcome,
    HttpStatus status
  ) {
    assertThatThrownBy(delivery::run).isInstanceOfSatisfying(
      ResponseStatusException.class,
      thrown -> assertThat(thrown.getStatusCode()).isEqualTo(status)
    );
    assertThat(counted()).containsOnlyKeys(outcome).containsEntry(outcome, 1.0);
    verifyNoInteractions(client, inbound);
  }

  // -------------------------------------------------------------- 401s

  @Test
  void noCapturedBodyIs401AndCountedNoRawBody() {
    assertRejected(
      () -> service.handle(null, name -> null),
      "no_raw_body",
      HttpStatus.UNAUTHORIZED
    );
  }

  @Test
  void anEmptyBodyIsARejectedSignatureNotANoRawBody() {
    assertRejected(
      () -> service.handle(new byte[0], name -> null),
      "rejected_signature",
      HttpStatus.UNAUTHORIZED
    );
  }

  @Test
  void aMissingSvixHeaderIsRejected() {
    String body = event("email.received");
    for (String missing : List.of(
      "svix-id",
      "svix-timestamp",
      "svix-signature"
    )) {
      Map<String, String> headers = new HashMap<>(sign(body, now(), SECRET));
      headers.remove(missing);

      assertThatThrownBy(() ->
        service.handle(body.getBytes(StandardCharsets.UTF_8), headers::get)
      ).isInstanceOf(ResponseStatusException.class);
    }
    assertThat(counted())
      .containsOnlyKeys("rejected_signature")
      .containsEntry("rejected_signature", 3.0);
    verifyNoInteractions(client, inbound);
  }

  @Test
  void aTamperedBodyIsRejected() {
    Map<String, String> headers = sign(event("email.received"), now(), SECRET);

    assertRejected(
      () ->
        service.handle(
          event("email.delivered").getBytes(StandardCharsets.UTF_8),
          headers::get
        ),
      "rejected_signature",
      HttpStatus.UNAUTHORIZED
    );
  }

  @Test
  void aWrongSecretIsRejected() {
    String body = event("email.received");
    Map<String, String> headers = sign(
      body,
      now(),
      "whsec_" +
        Base64.getEncoder().encodeToString(
          "some-other-secret".getBytes(StandardCharsets.UTF_8)
        )
    );

    assertRejected(
      () -> service.handle(body.getBytes(StandardCharsets.UTF_8), headers::get),
      "rejected_signature",
      HttpStatus.UNAUTHORIZED
    );
  }

  @ParameterizedTest(name = "a timestamp {0}s from now is rejected")
  @CsvSource({ "-600", "600" })
  void aTimestampOutsideTheToleranceIsRejected(long offset) {
    String body = event("email.received");
    Map<String, String> headers = sign(body, now() + offset, SECRET);

    assertRejected(
      () -> service.handle(body.getBytes(StandardCharsets.UTF_8), headers::get),
      "rejected_signature",
      HttpStatus.UNAUTHORIZED
    );
  }

  @Test
  void aValidlySignedBodyThatIsNotAnEventIsRejectedToo() {
    String body = "this is not json";
    Map<String, String> headers = sign(body, now(), SECRET);

    assertRejected(
      () -> service.handle(body.getBytes(StandardCharsets.UTF_8), headers::get),
      "rejected_signature",
      HttpStatus.UNAUTHORIZED
    );
  }

  @Test
  void aCorrectSignatureUnderAnotherSchemeIsRejected() {
    String body = event("email.received");
    Map<String, String> headers = new HashMap<>(sign(body, now(), SECRET));
    String digest = headers.get("svix-signature").substring("v1,".length());

    for (String scheme : List.of("v2,", "v1a,", "")) {
      headers.put("svix-signature", scheme + digest);

      assertThatThrownBy(() ->
        service.handle(body.getBytes(StandardCharsets.UTF_8), headers::get)
      ).isInstanceOf(ResponseStatusException.class);
    }
    verifyNoInteractions(client, inbound);
  }

  @Test
  void anyOneOfSeveralSignaturesIsEnoughSoASecretCanBeRotated() {
    String body = event("email.delivered");
    Map<String, String> headers = new HashMap<>(sign(body, now(), SECRET));
    headers.put(
      "svix-signature",
      "v1,AAAA v2,ignored " + headers.get("svix-signature")
    );

    var ack = service.handle(
      body.getBytes(StandardCharsets.UTF_8),
      headers::get
    );

    assertThat(ack.outcome()).isEqualTo("ignored_event");
  }

  // ------------------------------------------------------------ ignored

  @Test
  void anEventThatIsNotEmailReceivedIsIgnoredWithoutAFetch() {
    var ack = deliver(event("email.delivered"));

    assertThat(ack).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, "ignored_event")
    );
    assertThat(counted())
      .containsOnlyKeys("ignored_event")
      .containsEntry("ignored_event", 1.0);
    verifyNoInteractions(client, inbound);
  }

  // ---------------------------------------------------- the 503 / 200 split

  @ParameterizedTest(name = "a retryable {0} is 503 and counted fetch_failed")
  @CsvSource({ "429", "500", "503" })
  void aRetryableFetchFailureIs503(int status) {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.failed(new Failure("whatever", status))
    );

    assertThatThrownBy(() ->
      deliver(event("email.received"))
    ).isInstanceOfSatisfying(ResponseStatusException.class, thrown ->
      assertThat(thrown.getStatusCode()).isEqualTo(
        HttpStatus.SERVICE_UNAVAILABLE
      )
    );
    assertThat(counted())
      .containsOnlyKeys("fetch_failed")
      .containsEntry("fetch_failed", 1.0);
    verifyNoInteractions(inbound);
  }

  @Test
  void noAnswerAtAllIs503() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.failed(new Failure("application_error", null))
    );

    assertThatThrownBy(() -> deliver(event("email.received"))).isInstanceOf(
      ResponseStatusException.class
    );
    assertThat(counted()).containsOnlyKeys("fetch_failed");
  }

  @ParameterizedTest(name = "a permanent {0} is 200 and counted fetch_failed")
  @CsvSource({ "404", "401", "403" })
  void aPermanentFetchFailureIs200(int status) {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.failed(new Failure("not_found", status))
    );

    var ack = deliver(event("email.received"));

    assertThat(ack).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, "fetch_failed")
    );
    assertThat(counted())
      .containsOnlyKeys("fetch_failed")
      .containsEntry("fetch_failed", 1.0);
    verifyNoInteractions(inbound);
  }

  @Test
  void aSignedEventWithNoEmailIdIsAPermanentFailureWithNoCall() {
    String body = "{\"type\":\"email.received\",\"data\":{}}";

    var ack = service.handle(
      body.getBytes(StandardCharsets.UTF_8),
      sign(body, now(), SECRET)::get
    );

    assertThat(ack.outcome()).isEqualTo("fetch_failed");
    verifyNoInteractions(client, inbound);
  }

  // -------------------------------------------------------- invalid payload

  @Test
  void aSenderThatIsNotAnAddressIsInvalidPayloadAndNothingIsRouted() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("not an address"))
    );

    var ack = deliver(event("email.received"));

    assertThat(ack).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, "invalid_payload")
    );
    assertThat(counted())
      .containsOnlyKeys("invalid_payload")
      .containsEntry("invalid_payload", 1.0);
    verifyNoInteractions(inbound);
  }

  // -------------------------------------------------------- accept() ran

  @ParameterizedTest(
    name = "accept() answering {0} is counted and returned as it is"
  )
  @CsvSource({
    "TICKET_CREATED",
    "MESSAGE_APPENDED",
    "DUPLICATE",
    "UNROUTABLE_ADDRESS",
    "TENANT_INACTIVE",
    "SENDER_NOT_PERMITTED",
    "SELF_ADDRESSED",
  })
  void acceptsOutcomeIsTheAnswerAndTheLabel(InboundOutcome outcome) {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("customer@acme.test"))
    );
    when(inbound.accept(any(), any())).thenReturn(outcome);

    var ack = deliver(event("email.received"));

    assertThat(ack).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, outcome.wire())
    );
    assertThat(counted())
      .containsOnlyKeys(outcome.wire())
      .containsEntry(outcome.wire(), 1.0);
  }

  @Test
  void theMailAcceptSeesIsTheMappedOneAndNoAttachmentListIsSpentOnIt() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("Customer@Acme.test"))
    );
    when(inbound.accept(any(), any())).thenReturn(
      InboundOutcome.TICKET_CREATED
    );

    deliver(event("email.received"));

    ArgumentCaptor<InboundEmail> mapped = ArgumentCaptor.forClass(
      InboundEmail.class
    );
    verify(inbound).accept(mapped.capture(), any());
    assertThat(mapped.getValue().from()).isEqualTo("customer@acme.test");
    assertThat(mapped.getValue().to()).isEqualTo(
      "support+" + TOKEN + "@inbound.test"
    );
    verify(client, never()).listAttachments(anyString());
  }

  @Test
  void anAcceptThatThrowsCountsNothingBecauseThereIsNoExit() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("customer@acme.test"))
    );
    when(inbound.accept(any(), any())).thenThrow(
      new IllegalStateException("peer down")
    );

    assertThatThrownBy(() -> deliver(event("email.received"))).isInstanceOf(
      IllegalStateException.class
    );
    assertThat(counted()).isEmpty();
  }

  // ------------------------------------------------------ attachment URLs

  private Map<String, RemoteAttachmentSource> sourcesFor(AttachmentList page) {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("customer@acme.test"))
    );
    when(client.listAttachments(EMAIL_ID)).thenReturn(Result.ok(page));
    when(inbound.accept(any(), any())).thenReturn(
      InboundOutcome.TICKET_CREATED
    );
    deliver(event("email.received"));

    ArgumentCaptor<AcceptOptions> options = ArgumentCaptor.forClass(
      AcceptOptions.class
    );
    verify(inbound).accept(any(), options.capture());

    return options.getValue().fetchAttachmentUrls().get();
  }

  private static AttachmentSource source(
    String id,
    String url,
    String expires
  ) {
    return new AttachmentSource(id, url, expires);
  }

  @Test
  void onlyHttpsUrlsWithinTheLengthBoundArePassedOn() {
    String atBound =
      "https://x.test/" +
      "a".repeat(ResendInboundService.MAX_SOURCE_URL_LENGTH - 15);
    String overBound = atBound + "a";

    var sources = sourcesFor(
      new AttachmentList(
        false,
        List.of(
          source("ok", "https://x.test/a", "2030-01-01T00:00:00.000Z"),
          source("plain", "http://x.test/a", "2030-01-01T00:00:00.000Z"),
          source("edge", atBound, "2030-01-01T00:00:00.000Z"),
          source("long", overBound, "2030-01-01T00:00:00.000Z"),
          source("none", null, "2030-01-01T00:00:00.000Z")
        )
      )
    );

    assertThat(sources).containsOnlyKeys("ok", "edge");
    assertThat(atBound).hasSize(ResendInboundService.MAX_SOURCE_URL_LENGTH);
  }

  @Test
  void aRetryableListFailureIs503BeforeAnythingIsWritten() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("customer@acme.test"))
    );
    when(client.listAttachments(EMAIL_ID)).thenReturn(
      Result.failed(new Failure("rate_limit_exceeded", 429))
    );
    when(inbound.accept(any(), any())).thenReturn(
      InboundOutcome.TICKET_CREATED
    );
    deliver(event("email.received"));
    ArgumentCaptor<AcceptOptions> options = ArgumentCaptor.forClass(
      AcceptOptions.class
    );
    verify(inbound).accept(any(), options.capture());

    assertThatThrownBy(() ->
      options.getValue().fetchAttachmentUrls().get()
    ).isInstanceOfSatisfying(ResponseStatusException.class, thrown ->
      assertThat(thrown.getStatusCode()).isEqualTo(
        HttpStatus.SERVICE_UNAVAILABLE
      )
    );
    assertThat(counted()).containsEntry("fetch_failed", 1.0);
  }

  @Test
  void aPermanentListFailureDeliversTheMailWithoutItsAttachments() {
    when(client.getEmail(EMAIL_ID)).thenReturn(
      Result.ok(mail("customer@acme.test"))
    );
    when(client.listAttachments(EMAIL_ID)).thenReturn(
      Result.failed(new Failure("not_found", 404))
    );
    when(inbound.accept(any(), any())).thenReturn(
      InboundOutcome.TICKET_CREATED
    );
    deliver(event("email.received"));
    ArgumentCaptor<AcceptOptions> options = ArgumentCaptor.forClass(
      AcceptOptions.class
    );
    verify(inbound).accept(any(), options.capture());

    assertThat(options.getValue().fetchAttachmentUrls().get()).isEmpty();
    assertThat(counted()).doesNotContainKey("fetch_failed");
  }

  // -------------------------------------------------------- expiry parsing

  @Test
  void expiryParsesIsoAndTheDatabaseFormAndIsNullWhenUnreadable() {
    Instant expected = Instant.parse("2030-01-01T10:15:30Z");

    assertThat(
      ResendInboundService.parseInstant("2030-01-01T10:15:30.000Z")
    ).isEqualTo(expected);
    assertThat(
      ResendInboundService.parseInstant("2030-01-01T10:15:30+00:00")
    ).isEqualTo(expected);
    assertThat(
      ResendInboundService.parseInstant("2030-01-01 10:15:30+00")
    ).isEqualTo(expected);
    assertThat(
      ResendInboundService.parseInstant("2030-01-01T11:15:30+01:00")
    ).isEqualTo(expected);
    assertThat(ResendInboundService.parseInstant("garbage")).isNull();
    assertThat(ResendInboundService.parseInstant(null)).isNull();
  }
}

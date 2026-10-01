package com.synapsedesk.gateway.webhooks;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Billing.StripeWebhookRequest;
import synapsedesk.auth.Billing.StripeWebhookResponse;
import synapsedesk.auth.BillingServiceGrpc;
import tools.jackson.databind.json.JsonMapper;

/**
 * `WebhooksApi` — inbound webhook intake. Sharpest guard here is the Resend
 * (svix / Standard Webhooks) signature verification: it is the ONLY thing
 * standing between an unauthenticated caller and this route doing anything at
 * all, ported from {@code test/utils/standard-webhooks.ts}'s independent
 * signer — this test signs a request the same way, deliberately not by
 * calling the controller's own {@code sign()}, so a broken verifier can't
 * agree with itself.
 */
class WebhooksControllerTest {

  private static final String WEBHOOK_SECRET =
    "whsec_" +
    Base64.getEncoder().encodeToString(
      "a-test-secret-32-bytes-long!!!!".getBytes(StandardCharsets.UTF_8)
    );

  private final BillingServiceGrpc.BillingServiceBlockingStub stub = mock(
    BillingServiceGrpc.BillingServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final InboundEmailProperties inboundEmail =
    new InboundEmailProperties(
      "shared-secret",
      "inbound.test",
      "noreply@test",
      WEBHOOK_SECRET,
      "re_test_key"
    );
  private WebhooksController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.origin(any())).thenReturn(
      new RequestOrigin("127.0.0.1", "test-agent")
    );
    controller = new WebhooksController(
      stub,
      currentUser,
      inboundEmail,
      new JsonMapper()
    );
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  private static void requestWithBody(
    byte[] body,
    java.util.Map<String, String> headers
  ) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    headers.forEach(request::addHeader);
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new CachedBodyRequest(request, body))
    );
  }

  private static void requestWithNoRawBody() {
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(new MockHttpServletRequest())
    );
  }

  /** Independent of {@link WebhooksController#sign}, same algorithm as `standard-webhooks.ts`. */
  private static java.util.Map<String, String> signStandardWebhook(
    String body,
    long timestampSeconds
  ) {
    String id = "msg_" + UUID.randomUUID();
    byte[] key = Base64.getDecoder().decode(
      WEBHOOK_SECRET.replaceFirst("^whsec_", "")
    );
    String signedContent = id + "." + timestampSeconds + "." + body;
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      String digest = Base64.getEncoder().encodeToString(
        mac.doFinal(signedContent.getBytes(StandardCharsets.UTF_8))
      );
      return java.util.Map.of(
        "svix-id",
        id,
        "svix-timestamp",
        String.valueOf(timestampSeconds),
        "svix-signature",
        "v1," + digest
      );
    } catch (NoSuchAlgorithmException | InvalidKeyException e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void aValidSignatureForAnUnrelatedEventTypeIsIgnoredAndAnswered200() {
    String body =
      "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"x\"}}";
    requestWithBody(
      body.getBytes(StandardCharsets.UTF_8),
      signStandardWebhook(body, nowSeconds())
    );

    var response = controller.inboundEmailControllerResendV1();

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().data()).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, "ignored_event")
    );
  }

  @Test
  void aValidSignatureForEmailReceivedIsRefusedWithARetryable503() {
    String body = "{\"type\":\"email.received\",\"data\":{\"email_id\":\"x\"}}";
    requestWithBody(
      body.getBytes(StandardCharsets.UTF_8),
      signStandardWebhook(body, nowSeconds())
    );

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.inboundEmailControllerResendV1()
    );

    assertThat(thrown.getStatusCode()).isEqualTo(
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  @Test
  void aTamperedBodyIsRefusedWith401() {
    String signedBody =
      "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"x\"}}";
    var headers = signStandardWebhook(signedBody, nowSeconds());
    String tampered =
      "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"y\"}}";
    requestWithBody(tampered.getBytes(StandardCharsets.UTF_8), headers);

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.inboundEmailControllerResendV1()
    );

    assertThat(thrown.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void aStaleTimestampIsRefusedWith401() {
    String body =
      "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"x\"}}";
    requestWithBody(
      body.getBytes(StandardCharsets.UTF_8),
      signStandardWebhook(body, nowSeconds() - 600)
    );

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.inboundEmailControllerResendV1()
    );

    assertThat(thrown.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void aMissingSignatureHeaderIsRefusedWith401() {
    String body =
      "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"x\"}}";
    var headers = new java.util.HashMap<>(
      signStandardWebhook(body, nowSeconds())
    );
    headers.remove("svix-signature");
    requestWithBody(body.getBytes(StandardCharsets.UTF_8), headers);

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.inboundEmailControllerResendV1()
    );

    assertThat(thrown.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void noRawBodyIsRefusedWith401() {
    requestWithNoRawBody();

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.inboundEmailControllerResendV1()
    );

    assertThat(thrown.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void stripeForwardsTheExactRawBytesAndSignatureOverGrpc() {
    byte[] body = "{\"id\":\"evt_1\"}".getBytes(StandardCharsets.UTF_8);
    requestWithBody(body, java.util.Map.of());
    when(stub.handleStripeWebhook(any())).thenReturn(
      StripeWebhookResponse.newBuilder().setStatus("applied").build()
    );

    var response = controller.webhooksControllerStripeV1("t=1,v1=abc");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().data()).isEqualTo(
      new StripeWebhookAcknowledgementDto(true, "applied")
    );

    org.mockito.ArgumentCaptor<StripeWebhookRequest> captor =
      org.mockito.ArgumentCaptor.forClass(StripeWebhookRequest.class);
    org.mockito.Mockito.verify(stub).handleStripeWebhook(captor.capture());
    assertThat(captor.getValue().getPayload().toByteArray()).isEqualTo(body);
    assertThat(captor.getValue().getSignature()).isEqualTo("t=1,v1=abc");
  }

  @Test
  void stripeWithNoRawBodyIsRefusedWith400AndNeverCallsThePeer() {
    requestWithNoRawBody();

    ResponseStatusException thrown = Assertions.assertThrows(
      ResponseStatusException.class,
      () -> controller.webhooksControllerStripeV1("t=1,v1=abc")
    );

    assertThat(thrown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    org.mockito.Mockito.verify(
      stub,
      org.mockito.Mockito.never()
    ).handleStripeWebhook(any());
  }

  private static long nowSeconds() {
    return java.time.Instant.now().getEpochSecond();
  }
}

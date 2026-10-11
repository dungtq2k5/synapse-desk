package com.synapsedesk.gateway.webhooks;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestOrigin;
import com.synapsedesk.gateway.common.web.CachedBodyRequest;
import com.synapsedesk.gateway.inbound.ResendInboundService;
import java.nio.charset.StandardCharsets;
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

/**
 * {@link WebhooksController}: the Stripe passthrough forwards the exact raw bytes
 * and signature, and the Resend route hands its raw bytes and headers to
 * {@link ResendInboundService} — whose own test holds the signature, the fetch
 * and every exit.
 */
class WebhooksControllerTest {

  private final BillingServiceGrpc.BillingServiceBlockingStub stub = mock(
    BillingServiceGrpc.BillingServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private final ResendInboundService resendInbound = mock(
    ResendInboundService.class
  );
  private WebhooksController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.origin(any())).thenReturn(
      new RequestOrigin("127.0.0.1", "test-agent")
    );
    controller = new WebhooksController(stub, currentUser, resendInbound);
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

  @Test
  void resendHandsTheRawBytesAndTheHeadersToTheService() {
    byte[] body = "{\"type\":\"x\"}".getBytes(StandardCharsets.UTF_8);
    requestWithBody(body, java.util.Map.of("svix-id", "msg_1"));
    when(resendInbound.handle(any(), any())).thenReturn(
      new ResendWebhookAcknowledgementDto(true, "ignored_event")
    );

    var response = controller.inboundEmailControllerResendV1();

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().data()).isEqualTo(
      new ResendWebhookAcknowledgementDto(true, "ignored_event")
    );
    org.mockito.ArgumentCaptor<byte[]> bytes =
      org.mockito.ArgumentCaptor.forClass(byte[].class);
    org.mockito.ArgumentCaptor<
      java.util.function.Function<String, String>
    > header = org.mockito.ArgumentCaptor.forClass(
      java.util.function.Function.class
    );
    org.mockito.Mockito.verify(resendInbound).handle(
      bytes.capture(),
      header.capture()
    );
    assertThat(bytes.getValue()).isEqualTo(body);
    assertThat(header.getValue().apply("svix-id")).isEqualTo("msg_1");
  }

  @Test
  void aBodylessRequestIsPassedOnAsEmptyBytesSoItIsABadSignatureNotAConfigFailure() {
    // The body filter lets a bodyless request through unwrapped.
    requestWithNoRawBody();
    when(resendInbound.handle(any(), any())).thenReturn(
      new ResendWebhookAcknowledgementDto(true, "x")
    );

    controller.inboundEmailControllerResendV1();

    org.mockito.ArgumentCaptor<byte[]> bytes =
      org.mockito.ArgumentCaptor.forClass(byte[].class);
    org.mockito.Mockito.verify(resendInbound).handle(bytes.capture(), any());
    assertThat(bytes.getValue()).isEmpty();
  }

  @Test
  void aDeclaredBodyThatWasNeverCapturedIsPassedAsNullSoTheServiceCountsNoRawBody() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setContent("{\"type\":\"x\"}".getBytes(StandardCharsets.UTF_8));
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(request)
    );
    when(resendInbound.handle(any(), any())).thenReturn(
      new ResendWebhookAcknowledgementDto(true, "x")
    );

    controller.inboundEmailControllerResendV1();

    org.mockito.Mockito.verify(resendInbound).handle(
      org.mockito.ArgumentMatchers.isNull(),
      any()
    );
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
}

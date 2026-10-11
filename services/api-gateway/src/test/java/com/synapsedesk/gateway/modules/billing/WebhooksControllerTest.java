package com.synapsedesk.gateway.modules.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestOrigin;
import com.synapsedesk.gateway.common.web.CachedBodyRequest;
import com.synapsedesk.gateway.modules.billing.dto.rest.StripeWebhookAcknowledgementDto;
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
 * and signature.
 */
class WebhooksControllerTest {

  private final BillingServiceGrpc.BillingServiceBlockingStub stub = mock(
    BillingServiceGrpc.BillingServiceBlockingStub.class
  );
  private final CurrentUser currentUser = mock(CurrentUser.class);
  private WebhooksController controller;

  @BeforeEach
  void setUp() {
    when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
    when(stub.withInterceptors(any())).thenReturn(stub);
    when(currentUser.origin(any())).thenReturn(
      new RequestOrigin("127.0.0.1", "test-agent")
    );
    controller = new WebhooksController(stub, currentUser);
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

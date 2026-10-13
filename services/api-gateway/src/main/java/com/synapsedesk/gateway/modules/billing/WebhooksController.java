package com.synapsedesk.gateway.modules.billing;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.openapi.RouteSecurity;
import com.synapsedesk.gateway.common.throttle.SkipThrottle;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.CachedBodyRequest;
import com.synapsedesk.gateway.modules.billing.dto.rest.StripeWebhookAcknowledgementDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Billing.StripeWebhookRequest;
import synapsedesk.auth.Billing.StripeWebhookResponse;
import synapsedesk.auth.BillingServiceGrpc;

/**
 * `POST /webhooks/stripe` — Stripe's INBOUND webhook intake, unrelated to
 * `WebhookEndpointsApi` (this system's own OUTBOUND subscriptions). It bypasses
 * auth/lifecycle/tenant/throttle: the caller's signature over the exact raw
 * bytes IS the credential, and there is no tenant until the payload names one.
 * {@code InboundEmailController} is the other intake, under the same tag.
 *
 * <p>A thin passthrough: the gateway checks only that a raw body and a
 * signature header exist, then forwards both verbatim over gRPC — auth-service
 * owns the Stripe secret and verifies the HMAC. Re-serializing the body (even
 * whitespace-only) breaks that HMAC forever, which is why this reads {@link
 * CachedBodyRequest#body()} directly rather than any bound DTO. Always 200
 * except a signature failure, because Stripe retries any non-2xx — an
 * unmappable event is still 200.
 *
 * <p>{@link StripeWebhookAcknowledgementDto} names what the handler returns;
 * the published contract once borrowed an unrelated route's envelope for it.
 */
@Tag(name = "Webhooks")
@RestController
@RequestMapping(ApiPaths.V1)
// Public intakes, authenticated by their own signature: no JWT check runs here, so the lifecycle gate never does either.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
public class WebhooksController {

  private static final long STRIPE_DEADLINE_SECONDS = 20;

  private final BillingServiceGrpc.BillingServiceBlockingStub stub;
  private final CurrentUser currentUser;

  public WebhooksController(
    BillingServiceGrpc.BillingServiceBlockingStub stub,
    CurrentUser currentUser
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @PostMapping(value = "/webhooks/stripe", produces = { "application/json" })
  @SkipThrottle
  @ApiErrors(value = { "400" }, throttled = false)
  public ResponseEntity<
    ApiResponse<StripeWebhookAcknowledgementDto>
  > webhooksControllerStripeV1(
    @RequestHeader(
      value = "stripe-signature",
      required = true
    ) String stripeSignature
  ) {
    HttpServletRequest request = CurrentRequest.request();
    if (!(request instanceof CachedBodyRequest cached)) {
      // A configuration failure (rawBody not captured), not a caller one —
      // kept distinct so nobody chases a "bad signature" that was actually a
      // missing filter.
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Webhook body could not be read for signature verification"
      );
    }

    StripeWebhookRequest wire = StripeWebhookRequest.newBuilder()
      .setPayload(com.google.protobuf.ByteString.copyFrom(cached.body()))
      .setSignature(stripeSignature)
      .build();

    StripeWebhookResponse response = stub
      .withDeadlineAfter(STRIPE_DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(
          CallerMetadata.of(currentUser.origin(request))
        )
      )
      .handleStripeWebhook(wire);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        new StripeWebhookAcknowledgementDto(true, response.getStatus())
      )
    );
  }
}

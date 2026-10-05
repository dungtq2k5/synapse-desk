package com.synapsedesk.gateway.webhooks;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.inbound.ResendInboundService;
import com.synapsedesk.gateway.inbound.ResendPayloads;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.openapi.ApiErrors;
import com.synapsedesk.gateway.openapi.RouteSecurity;
import com.synapsedesk.gateway.openapi.WebhookIntake;
import com.synapsedesk.gateway.throttle.SkipThrottle;
import com.synapsedesk.gateway.web.ApiPaths;
import com.synapsedesk.gateway.web.ApiResponse;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
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
 * `WebhooksApi` — the gateway's two INBOUND webhook intakes, unrelated to
 * `WebhookEndpointsApi` (this system's own OUTBOUND subscriptions). Both
 * routes bypass auth/lifecycle/tenant/throttle the same way Node's
 * controllers document: the caller's signature over the exact raw bytes IS
 * the credential, and there is no tenant until the payload names one.
 *
 * <p><b>{@code stripe}</b> is a thin passthrough: the gateway checks only
 * that a raw body and a signature header exist, then forwards both verbatim
 * over gRPC — auth-service owns the Stripe secret and verifies the HMAC.
 * Re-serializing the body (even whitespace-only) breaks that HMAC forever,
 * which is why this reads {@link CachedBodyRequest#body()} directly rather
 * than any bound DTO. Always 200 except a signature failure, because Stripe
 * retries any non-2xx — an unmappable event is still 200.
 *
 * <p><b>{@code resend}</b> hands the raw bytes and the request's headers to
 * {@link ResendInboundService}, which verifies the Standard Webhooks (svix)
 * signature over those exact bytes before doing anything else, fetches the mail
 * Resend names, validates it, and runs it through the {@code accept()} pipeline.
 * It answers 200 for every outcome except a bad signature (401) and a fetch
 * failure a retry can fix (503), and counts every exit once.
 *
 * <p><b>Migrated off `WebhooksApi`.</b> Neither route had a real generated
 * DTO for `data` — the published contract borrows an unrelated route's
 * envelope for both, the same reused-wrapper shape the flip retires
 * elsewhere. {@link StripeWebhookAcknowledgementDto} and {@link
 * ResendWebhookAcknowledgementDto} name what each handler actually returns
 * instead — Node's own return-type annotations, not this port's invention.
 */
@Tag(name = "Webhooks")
@RestController
@RequestMapping(ApiPaths.V1)
// Public intakes, authenticated by their own signature: Node's JwtAuthGuard never runs here, so its lifecycle gate never does either.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
public class WebhooksController {

  private static final long STRIPE_DEADLINE_SECONDS = 20;

  private final BillingServiceGrpc.BillingServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final ResendInboundService resendInbound;

  public WebhooksController(
    BillingServiceGrpc.BillingServiceBlockingStub stub,
    CurrentUser currentUser,
    ResendInboundService resendInbound
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.resendInbound = resendInbound;
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
      // same distinction Node draws, so nobody chases a "bad signature" that
      // was actually a missing filter.
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

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @WebhookIntake(
    signatureHeader = ResendInboundService.SVIX_SIGNATURE,
    idempotencyKey = ResendPayloads.MESSAGE_ID,
    caller = ResendInboundService.CALLER
  )
  @PostMapping(
    value = "/webhooks/email/resend",
    produces = { "application/json" }
  )
  @SkipThrottle
  @ApiErrors(value = { "401", "503" }, throttled = false)
  public ResponseEntity<
    ApiResponse<ResendWebhookAcknowledgementDto>
  > inboundEmailControllerResendV1() {
    HttpServletRequest request = CurrentRequest.request();
    byte[] rawBody =
      request instanceof CachedBodyRequest cached
        ? cached.body()
        : // `JsonBodyFilter` deliberately passes a bodyless request through
          // unwrapped, so "no wrapper" is an EMPTY body (a bad signature, answered
          // 401) unless a body was declared and never captured — the configuration
          // failure that `no_raw_body` exists to name.
          request.getContentLengthLong() > 0
          ? null
          : new byte[0];

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "OK",
        resendInbound.handle(rawBody, request::getHeader)
      )
    );
  }
}

package com.synapsedesk.gateway.webhooks;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.generated.api.WebhooksApi;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.web.CachedBodyRequest;
import io.grpc.stub.MetadataUtils;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Billing.StripeWebhookRequest;
import synapsedesk.auth.Billing.StripeWebhookResponse;
import synapsedesk.auth.BillingServiceGrpc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

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
 * <p><b>{@code resend}</b> verifies the Standard Webhooks (svix) signature
 * itself, over those same raw bytes, before doing anything else. Scope of
 * this pass: signature verification and the {@code email.received} event
 * filter are ported faithfully; the {@code accept()} pipeline this system
 * runs afterward (mail fetch, self-loop detection, tenant/sender/thread
 * routing, attachment ingestion) is its own, much larger, unit of work and is
 * refused here with 503 rather than answered 200 — Resend redelivers a 503
 * for roughly 17 hours, so the mail is only delayed, not lost, once that
 * pipeline lands. A 200 here would tell Resend the mail was handled and it
 * would never be redelivered.
 */
@RestController
public class WebhooksController implements WebhooksApi {

  private static final long STRIPE_DEADLINE_SECONDS = 20;

  private static final String SVIX_ID_HEADER = "svix-id";
  private static final String SVIX_TIMESTAMP_HEADER = "svix-timestamp";
  private static final String SVIX_SIGNATURE_HEADER = "svix-signature";
  private static final String SVIX_SIGNATURE_SCHEME = "v1,";
  private static final long SVIX_TOLERANCE_SECONDS = 300;
  private static final String EMAIL_RECEIVED_EVENT_TYPE = "email.received";

  private final BillingServiceGrpc.BillingServiceBlockingStub stub;
  private final CurrentUser currentUser;
  private final InboundEmailProperties inboundEmail;
  private final ObjectMapper json;

  public WebhooksController(
    BillingServiceGrpc.BillingServiceBlockingStub stub,
    CurrentUser currentUser,
    InboundEmailProperties inboundEmail,
    ObjectMapper json
  ) {
    this.stub = stub;
    this.currentUser = currentUser;
    this.inboundEmail = inboundEmail;
    this.json = json;
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> webhooksControllerStripeV1(
    String stripeSignature
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
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(currentUser.origin(request)))
      )
      .handleStripeWebhook(wire);

    return ResponseEntity.ok(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(Map.of("received", true, "status", response.getStatus()))
    );
  }

  @Override
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> inboundEmailControllerResendV1() {
    HttpServletRequest request = CurrentRequest.request();
    if (!(request instanceof CachedBodyRequest cached)) {
      throw rejectedSignature();
    }

    String id = request.getHeader(SVIX_ID_HEADER);
    String timestamp = request.getHeader(SVIX_TIMESTAMP_HEADER);
    String signature = request.getHeader(SVIX_SIGNATURE_HEADER);
    if (id == null || timestamp == null || signature == null) {
      throw rejectedSignature();
    }

    if (!verifySignature(cached.body(), id, timestamp, signature)) {
      throw rejectedSignature();
    }

    String eventType = eventType(cached.body());
    if (!EMAIL_RECEIVED_EVENT_TYPE.equals(eventType)) {
      return ResponseEntity.ok(
        new AuthControllerForgotPasswordV1202Response()
          .success(true)
          .statusCode(BigDecimal.valueOf(200))
          .message("OK")
          .data(Map.of("received", true, "outcome", "ignored_event"))
      );
    }

    // The `accept()` pipeline (mail fetch, routing, attachment ingestion) is
    // not yet ported — see the class docblock for why 503, not 200, is the
    // correct placeholder.
    throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Inbound mail fetch failed");
  }

  private ResponseStatusException rejectedSignature() {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Signature could not be verified");
  }

  /**
   * The Standard Webhooks scheme Resend signs with: {@code v1,<base64 HMAC-SHA256>}
   * over {@code "<id>.<timestamp>.<raw body>"}, keyed by the webhook secret's
   * bytes after its {@code whsec_} prefix is stripped and base64-decoded.
   * Reproduced from {@code test/utils/standard-webhooks.ts}'s signer, which is
   * itself independent of the provider's own verifier.
   */
  private boolean verifySignature(byte[] body, String id, String timestamp, String signatureHeader) {
    long timestampSeconds;
    try {
      timestampSeconds = Long.parseLong(timestamp);
    } catch (NumberFormatException e) {
      return false;
    }
    if (Math.abs(java.time.Instant.now().getEpochSecond() - timestampSeconds) > SVIX_TOLERANCE_SECONDS) {
      return false;
    }

    byte[] expected = sign(body, id, timestamp);

    for (String token : signatureHeader.split(" ")) {
      if (!token.startsWith(SVIX_SIGNATURE_SCHEME)) {
        continue;
      }
      byte[] candidate;
      try {
        candidate = Base64.getDecoder().decode(token.substring(SVIX_SIGNATURE_SCHEME.length()));
      } catch (IllegalArgumentException e) {
        continue;
      }
      if (MessageDigest.isEqual(expected, candidate)) {
        return true;
      }
    }

    return false;
  }

  private byte[] sign(byte[] body, String id, String timestamp) {
    byte[] key = Base64.getDecoder().decode(inboundEmail.resendWebhookSecret().replaceFirst("^whsec_", ""));
    byte[] signedContent = (id + "." + timestamp + ".").getBytes(StandardCharsets.UTF_8);
    byte[] content = new byte[signedContent.length + body.length];
    System.arraycopy(signedContent, 0, content, 0, signedContent.length);
    System.arraycopy(body, 0, content, signedContent.length, body.length);

    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return mac.doFinal(content);
    } catch (NoSuchAlgorithmException | InvalidKeyException e) {
      throw new IllegalStateException("HmacSHA256 is not available", e);
    }
  }

  /** {@code type} from the verified body's JSON. */
  private String eventType(byte[] body) {
    JsonNode type = json.readTree(body).get("type");
    return type == null ? null : type.asString();
  }
}

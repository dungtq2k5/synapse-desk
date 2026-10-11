package com.synapsedesk.gateway.modules.inboundemail;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.openapi.RouteSecurity;
import com.synapsedesk.gateway.common.openapi.WebhookIntake;
import com.synapsedesk.gateway.common.throttle.SkipThrottle;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.CachedBodyRequest;
import com.synapsedesk.gateway.modules.billing.WebhooksController;
import com.synapsedesk.gateway.modules.inboundemail.ResendInboundService;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads;
import com.synapsedesk.gateway.modules.inboundemail.dto.rest.ResendWebhookAcknowledgementDto;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * `POST /webhooks/email/resend` — Resend's INBOUND webhook intake: inbound email
 * becomes tickets and replies. It bypasses auth/lifecycle/tenant/throttle: the
 * caller's signature over the exact raw bytes IS the credential, and there is no
 * tenant until the payload names one. {@code WebhooksController} is the other
 * intake, under the same tag.
 *
 * <p>Hands the raw bytes and the request's headers to {@link
 * ResendInboundService}, which verifies the Standard Webhooks (svix) signature
 * over those exact bytes before doing anything else, fetches the mail Resend
 * names, validates it, and runs it through the {@code accept()} pipeline. It
 * answers 200 for every outcome except a bad signature (401) and a fetch failure
 * a retry can fix (503), and counts every exit once.
 *
 * <p>{@link ResendWebhookAcknowledgementDto} names what the handler returns;
 * the published contract once borrowed an unrelated route's envelope for it.
 */
@Tag(name = "Webhooks")
@RestController
@RequestMapping(ApiPaths.V1)
// Public intake, authenticated by its own signature: no JWT check runs here, so the lifecycle gate never does either.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
public class InboundEmailController {

  private final ResendInboundService resendInbound;

  public InboundEmailController(ResendInboundService resendInbound) {
    this.resendInbound = resendInbound;
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

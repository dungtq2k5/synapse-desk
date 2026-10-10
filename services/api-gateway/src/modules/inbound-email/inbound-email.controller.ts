import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExtension, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  RESEND_SIGNATURE_HEADERS,
  ResendInboundService,
  type ResendWebhookAck,
} from './resend-inbound.service';

/**
 * `POST /webhooks/email/resend` — Resend's `email.received` webhook, the one
 * way inbound mail enters the system.
 *
 * A separate controller from `/webhooks/stripe`, sharing its `@ApiTags`
 * (so the two appear together at `/docs`) but not its module — a feature module
 * owns its own surface.
 *
 * **Four global mechanisms it bypasses, the same four Stripe documents:**
 *
 * | Mechanism | Why it must not apply |
 * | --- | --- |
 * | **Auth guard** | There is no JWT. Resend's webhook signature is the credential, checked before anything else runs |
 * | **Lifecycle gate** | The interceptor reads status off the caller's identity, and the tenant is resolved FROM the mail. The service re-applies the check once the tenant is known, or a suspended tenant quietly accumulates tickets |
 * | **Tenant scoping** | There is no tenant context until the address is parsed |
 * | **Rate limiting** | `@SkipThrottle`. A webhook retry burst is Resend doing its job; throttling it drops mail |
 *
 * **No `@Body()`.** The handler reads the raw bytes the signature covers and
 * builds the mail from Resend's API, so the global `ValidationPipe` never runs
 * here — `ResendInboundService` validates the mail it builds explicitly.
 *
 * See `docs/decisions/0018-inbound-email-routing-and-threading.md` and
 * `docs/decisions/0046-resend-for-both-directions.md`.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class InboundEmailController {
  constructor(private readonly resendInbound: ResendInboundService) {}

  @ApiOperation({
    summary: 'Inbound email intake',
    description:
      '**Not a public endpoint despite carrying no security scheme.** Every ' +
      'request is authenticated by a Standard Webhooks signature over the ' +
      `exact raw bytes of the body, in \`${RESEND_SIGNATURE_HEADERS.signature}\` ` +
      `with \`${RESEND_SIGNATURE_HEADERS.id}\` and ` +
      `\`${RESEND_SIGNATURE_HEADERS.timestamp}\` — a claim OpenAPI has no way ` +
      'to express. Called only by Resend; no client should ever reach it. ' +
      'Answers **200 for every outcome except a bad signature and a retryable ' +
      'fetch failure**, including mail this system deliberately drops: an ' +
      'unknown tenant token, a sender whose domain is not permitted, a mail ' +
      'that fails validation. A non-2xx tells Resend to retry for hours, so ' +
      'one misconfigured mail rule would become a retry loop; a 503 is ' +
      'answered only when fetching the mail failed in a way a retry can fix.',
    security: [],
  })
  @ApiWrappedResponse(undefined, {
    description:
      'Accepted, or deliberately dropped. The body carries an acknowledgement ' +
      'and the outcome, never the message.',
  })
  @ApiFilterErrors(['401', '503'], { throttled: false })
  @ApiExtension('x-webhook', {
    signatureHeader: RESEND_SIGNATURE_HEADERS.signature,
    idempotencyKey: 'message_id',
    caller: 'resend',
  })
  @Post('email/resend')
  @HttpCode(HttpStatus.OK)
  resend(@Req() request: RawBodyRequest<Request>): Promise<ResendWebhookAck> {
    return this.resendInbound.handle({
      rawBody: request.rawBody,
      header: (name) => request.header(name),
    });
  }
}

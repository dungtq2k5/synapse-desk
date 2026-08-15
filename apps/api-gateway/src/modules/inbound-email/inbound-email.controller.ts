import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExtension, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  INBOUND_SIGNATURE_HEADER,
  InboundSignatureGuard,
} from '../../common/guards/inbound-signature.guard';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';
import {
  InboundAttachmentUploadRequestDto,
  InboundAttachmentUploadResponseDto,
} from './dto/rest/inbound-attachment.dto';
import { InboundEmailService } from './inbound-email.service';

/**
 * `POST /webhooks/email/inbound` — the mail Worker's only entry point.
 *
 * **A separate controller from `/webhooks/stripe`, sharing its tag and path.**
 * 32-doc §3.1 says it "joins the existing `@ApiTags('Webhooks')` controller",
 * and it joins the TAG — the two appear together at `/docs`, which is what that
 * sentence is about. It does not join the billing MODULE: an email intake route
 * owned by billing is organisation-by-layer, and conventions §1.2 is explicit
 * that a feature module owns its own surface.
 *
 * **Four global mechanisms it bypasses, the same four Stripe documents:**
 *
 * | Mechanism | Why it must not apply |
 * | --- | --- |
 * | **Auth guard** | There is no JWT. The Worker's signature is the credential, and this gateway has no global auth guard — an unguarded controller is genuinely unauthenticated, which is why the signature guard below is not optional |
 * | **Lifecycle gate** | The INTERCEPTOR cannot run: it reads the status off the caller's identity, and the tenant is resolved FROM the payload instead. So the bypass is where the check happens, not whether it happens — the service re-applies it the moment the tenant is known, or a suspended tenant quietly accumulates tickets nobody is paying for |
 * | **Tenant scoping** | There is no tenant context until the address is parsed |
 * | **Rate limiting** | `@SkipThrottle`. A provider retry storm is Cloudflare doing its job; throttling it drops mail |
 *
 * Ticket creation is not metered on this route — and not on any other either:
 * the product has no per-tenant ticket quota, and the commercial control that
 * does exist is the lifecycle gate in the row above. Adding a limit here alone
 * would mean an emailed ticket could be refused where the identical ticket
 * typed into the web app is accepted.
 *
 * **200 for every outcome except a bad signature** — including mail this system
 * deliberately drops. An unknown tenant token, a disallowed sender domain and an
 * unparseable message all answer 200, because a 4xx tells the provider the
 * request was malformed and worth retrying, and one misconfigured mail rule
 * would become a retry loop against this endpoint.
 *
 * The exception is a signature failure, which is 401 precisely so the provider
 * stops. An infrastructure failure is the one thing that legitimately answers
 * 5xx: it means "unknown", and the provider's retry is the recovery.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class InboundEmailController {
  constructor(private readonly inboundEmail: InboundEmailService) {}

  @ApiOperation({
    summary: 'Inbound email intake',
    description:
      '**Not a public endpoint despite carrying no security scheme.** Every ' +
      'request is authenticated by an HMAC over the exact raw bytes of the ' +
      `body, in \`${INBOUND_SIGNATURE_HEADER}\` — a claim OpenAPI has no way ` +
      'to express. Called only by the mail Worker; no client should ever ' +
      'reach it. Answers **200 for every outcome except a bad signature**, ' +
      'including mail this system deliberately drops: an unknown tenant ' +
      'token, a sender whose domain is not permitted, or a message that ' +
      'cannot be parsed. A 4xx on those would tell the provider to retry, and ' +
      'one misconfigured mail rule would become a retry loop.',
    security: [],
  })
  @ApiWrappedResponse(undefined, {
    description:
      'Accepted, or deliberately dropped. The body carries an acknowledgement ' +
      'and the outcome, never the message.',
  })
  // **401, not Stripe's 400** — 32-doc §3. The credential was presented and
  // rejected, and 401 is the answer that tells the provider to stop rather
  // than retry.
  //
  // `throttled: false` mirrors the class's `@SkipThrottle()`: this route cannot
  // produce a 429 under any input, and a documented one would tell the Worker's
  // author to write a backoff for a status that never arrives. 500 stays — an
  // infrastructure failure here is real, and the retry it triggers is the
  // recovery.
  @ApiFilterErrors(['401'], { throttled: false })
  // Published so the Worker's contract and the code that enforces it cannot
  // drift — the same reason `@Cacheable` composes `x-cache`.
  @ApiExtension('x-webhook', {
    signatureHeader: INBOUND_SIGNATURE_HEADER,
    idempotencyKey: 'messageId',
    caller: 'cloudflare-email-worker',
  })
  @Post('email/inbound')
  // The guard, not a check in the handler: "a bad signature causes nothing to
  // happen" is only true if nothing has run yet — 31-doc §6.1.
  @UseGuards(InboundSignatureGuard)
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Body() payload: InboundEmailDto,
  ): Promise<{ received: true; outcome: string }> {
    const outcome = await this.inboundEmail.accept(payload);

    return { received: true, outcome };
  }

  /**
   * Presigned uploads for a mail's attachments — 31-doc §5, the reply half.
   *
   * **Called before the webhook, by the same Worker, over the same signature.**
   * The Worker parses the MIME, asks here which files it may store and where,
   * PUTs the bytes to storage directly, and then posts the webhook carrying
   * only object paths. The bytes never reach an application server, which is
   * the property the presign flow exists to hold — and the one an inbound mail
   * most threatens, because the Worker is handed the bytes whether anyone
   * wanted them or not.
   *
   * **200, not 201.** Nothing has been created: the caller has permission to
   * upload, and until the bytes land and the webhook binds them there is no
   * attachment. The same reason the `:messageId` presign route answers 200.
   *
   * **Never fails for an ineligible file.** Files this route will not store come
   * back in `declined`, by name, so the Worker can list them in
   * `droppedAttachments` and the ticket can still say what was left out.
   */
  @ApiOperation({
    summary:
      'Presign uploads for an inbound mail’s attachments, before the webhook',
  })
  @ApiWrappedResponse(InboundAttachmentUploadResponseDto)
  @ApiFilterErrors(['401'], { throttled: false })
  @ApiExtension('x-webhook', {
    signatureHeader: INBOUND_SIGNATURE_HEADER,
    caller: 'cloudflare-email-worker',
  })
  @Post('email/attachments')
  @UseGuards(InboundSignatureGuard)
  @HttpCode(HttpStatus.OK)
  presignAttachments(
    @Body() request: InboundAttachmentUploadRequestDto,
  ): Promise<InboundAttachmentUploadResponseDto> {
    return this.inboundEmail.presignAttachments(request);
  }
}

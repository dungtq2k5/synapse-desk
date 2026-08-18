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
 * A separate controller from `/webhooks/stripe`, sharing its `@ApiTags`
 * (so the two appear together at `/docs`) but not its module — a feature module
 * owns its own surface.
 *
 * **Four global mechanisms it bypasses, the same four Stripe documents:**
 *
 * | Mechanism | Why it must not apply |
 * | --- | --- |
 * | **Auth guard** | There is no JWT. The Worker's signature is the credential, and this gateway has no global auth guard — so the signature guard is not optional |
 * | **Lifecycle gate** | The interceptor reads status off the caller's identity, and the tenant is resolved FROM the payload. The service re-applies the check once the tenant is known, or a suspended tenant quietly accumulates tickets |
 * | **Tenant scoping** | There is no tenant context until the address is parsed |
 * | **Rate limiting** | `@SkipThrottle`. A provider retry storm is Cloudflare doing its job; throttling it drops mail |
 *
 * **200 for every outcome except a bad signature**, including mail this system
 * deliberately drops. A 4xx tells the provider the request was malformed and
 * worth retrying, so one misconfigured mail rule would become a retry loop.
 * A signature failure answers 401 precisely so the provider stops; an
 * infrastructure failure answers 5xx, where the retry is the recovery.
 *
 * See `docs/decisions/0018-inbound-email-routing-and-threading.md`.
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
  // **401, not Stripe's 400**. The credential was presented and
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
  // happen" is only true if nothing has run yet.
  @UseGuards(InboundSignatureGuard)
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Body() payload: InboundEmailDto,
  ): Promise<{ received: true; outcome: string }> {
    const outcome = await this.inboundEmail.accept(payload);

    return { received: true, outcome };
  }

  /**
   * Presigned uploads for a mail's attachments, the reply half.
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

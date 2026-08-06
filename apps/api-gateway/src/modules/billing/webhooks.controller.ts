import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentOrigin } from '../../common/decorators/current-origin.decorator';
import { RequestOrigin } from '@synapsedesk/common';
import { BillingGrpcClient } from './billing-grpc.client';

/**
 * `POST /webhooks/stripe` — and four global mechanisms it bypasses on purpose
 * (14-doc §3.3).
 *
 * | Mechanism | Why it must not apply |
 * | --- | --- |
 * | **Auth guard** | There is no JWT. The request is authenticated by Stripe's signature, which is a STRONGER claim than a bearer token, not a weaker one. No `@UseGuards(JwtAuthGuard)` here is the bypass — this gateway has no global auth guard, so an unguarded controller is genuinely unauthenticated |
 * | **Lifecycle gate** | The gate reads `organizations.status`; this endpoint's job is to WRITE it. A `SUSPENDED_PAST_DUE` tenant whose payment succeeds must be able to receive the event that reactivates them, or suspension is a one-way door. The bypass is automatic — the interceptor passes through any request with no identity — and it is asserted by a test rather than left to that coincidence |
 * | **Tenant scoping** | There is no tenant context. The tenant is resolved FROM the payload, and an unresolvable customer is stored with `organization_id = NULL` rather than dropped |
 * | **Per-tenant rate limiting** | `@SkipThrottle`. Throttling by tenant would drop a retry storm that is Stripe correctly doing its job — and a dropped retry is an entitlement that never lands |
 *
 * **Always 200, even for an event this system could not apply.** Stripe retries
 * on any non-2xx, so returning 500 for an unmappable price id would turn one
 * config typo into an escalating retry storm carrying an event that will never
 * succeed. The only non-2xx is a signature failure, which is Stripe's own
 * signal that something is wrong with the caller rather than with the event.
 */
@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly billing: BillingGrpcClient) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<{ received: true; status: string }> {
    // **THE trap** — 14-doc §3.2. Stripe's signature is computed over the
    // exact bytes of the request, and a JSON body parser deserializes and
    // re-serializes them: different key order, different whitespace, and
    // verification fails for every event forever.
    //
    // `request.rawBody` is populated because `NestFactory.create` is called
    // with `rawBody: true`, which buffers the original bytes BEFORE the global
    // parser runs. Its absence here is a configuration failure, not a client
    // one, so it says so rather than reporting an invalid signature — that
    // distinction is what stops someone spending an afternoon regenerating a
    // webhook secret that was never the problem.
    if (!request.rawBody) {
      this.logger.error(
        'The Stripe webhook received no raw body — NestFactory must be created with `rawBody: true`',
      );
      throw new BadRequestException(
        'Webhook body could not be read for signature verification',
      );
    }

    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    const result = await this.billing.handleStripeWebhook(
      request.rawBody,
      signature,
      origin,
    );

    return { received: true, status: result.status };
  }
}

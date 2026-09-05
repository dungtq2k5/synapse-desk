import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { verifyHmacSignature } from '@synapsedesk/common';
import { MetricsRegistry } from '../../modules/metrics/metrics.registry';

/** The header the mail Worker signs with. */
export const INBOUND_SIGNATURE_HEADER = 'x-inbound-signature';

/**
 * Authenticates the inbound-email webhook.
 *
 * **A GUARD rather than a check inside the handler**, because the property this
 * endpoint is built around is *"a bad signature causes nothing to happen"* — no
 * lookup, no RPC, no job, no log of the body. Guards run before interceptors,
 * pipes and the handler, so expressing it here makes that structural rather
 * than a promise every future edit has to keep. A test asserts it by spying the
 * auth-service client.
 *
 * **Verified HERE, unlike `/webhooks/stripe`**, which forwards raw bytes for
 * auth-service to verify. Copying that would spend a gRPC call before
 * authenticating, and the credentials differ in kind: Stripe's is a
 * billing-domain credential, this one an edge credential between two components
 * in this repo.
 *
 * **401, not 400 and never 5xx.** A 5xx tells the provider to retry, so a
 * misconfigured secret would become an unbounded retry loop.
 *
 * **Every exit counts itself**, into `MetricsRegistry.inboundEmailWebhook`.
 * The failure this endpoint exists to survive is bilateral — the Worker
 * receives the 401, this guard issues it — and only this end retains anything
 * an operator could later read. The `accepted` increment is the one easiest to
 * leave out and the one that catches the OTHER failure: a Worker that has
 * stopped calling produces exactly the same `rejected_signature` count as a
 * healthy system, which is zero.
 */
@Injectable()
export class InboundSignatureGuard implements CanActivate {
  private readonly logger = new Logger(InboundSignatureGuard.name);

  constructor(
    private readonly configService: ConfigService,
    // `MetricsRegistry` is `@Global()`, so this needs no module wiring — the
    // same one-line injection `RealtimeGateway` uses.
    private readonly metrics: MetricsRegistry,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    // **The raw bytes, not the parsed body**, the trap this
    // codebase has already been caught by once. A JSON parser deserializes and
    // re-serializes: different key order, different whitespace, a different
    // digest, and every signature fails in production while passing every local
    // test that builds the body itself.
    //
    // Its absence is a CONFIGURATION failure, not a caller one — `rawBody: true`
    // missing from `NestFactory.create`. Saying so is what stops somebody
    // spending an afternoon regenerating a secret that was never the problem.
    if (!request.rawBody) {
      this.logger.error(
        'Inbound email webhook received no raw body — NestFactory must be created with `rawBody: true`',
      );
      this.metrics.inboundEmailWebhook.inc({ outcome: 'no_raw_body' });

      throw new UnauthorizedException('Signature could not be verified');
    }

    const signature = request.header(INBOUND_SIGNATURE_HEADER);
    const secret = this.configService.getOrThrow<string>(
      'INBOUND_EMAIL_SECRET',
    );

    if (!verifyHmacSignature(request.rawBody, signature ?? '', secret)) {
      // **Nothing about the body is logged.** An unauthenticated caller can put
      // anything in it, and a rejected payload in the logs is an injection
      // surface plus a copy of mail this system decided not to accept.
      this.logger.warn('Inbound email webhook rejected: bad signature');
      this.metrics.inboundEmailWebhook.inc({ outcome: 'rejected_signature' });

      throw new UnauthorizedException('Invalid signature');
    }

    this.metrics.inboundEmailWebhook.inc({ outcome: 'accepted' });

    return true;
  }
}

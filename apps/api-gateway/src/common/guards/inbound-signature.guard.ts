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

/** The header the mail Worker signs with — 32-doc §2. */
export const INBOUND_SIGNATURE_HEADER = 'x-inbound-signature';

/**
 * Authenticates the inbound-email webhook — 31-doc §6.1, 32-doc §3.
 *
 * **A GUARD rather than a check inside the handler**, because the property this
 * endpoint is built around is *"a bad signature causes nothing to happen"* — no
 * lookup, no RPC, no job, no log of the body. Guards run before interceptors,
 * pipes and the handler, so expressing it here makes that structural instead of
 * a promise every future edit has to keep. 32-doc §3 test 3b asserts it by
 * spying the auth-service client.
 *
 * **Verified HERE, which is deliberately not what Stripe does** — 31-doc §6.1.
 * `/webhooks/stripe` forwards raw bytes and auth-service verifies, and copying
 * that would spend a gRPC call before authenticating. The credentials also
 * differ in kind: Stripe's secret is a billing-domain credential held where the
 * rest of that domain lives, while this one is an edge credential between two
 * components in this repo, protecting a route rather than a domain.
 *
 * **401, not 400 and never 5xx.** A 5xx tells the provider to retry, so a
 * misconfigured secret would become an unbounded retry loop against this
 * endpoint. 401 says the credential was presented and rejected, which is both
 * accurate and a signal to stop.
 */
@Injectable()
export class InboundSignatureGuard implements CanActivate {
  private readonly logger = new Logger(InboundSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    // **The raw bytes, not the parsed body** — 14-doc §3.2, the trap this
    // codebase has already been caught by once. A JSON parser deserialises and
    // re-serialises: different key order, different whitespace, a different
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

      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}

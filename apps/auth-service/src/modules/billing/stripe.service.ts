import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import Stripe from 'stripe';
import { formatErrorMsg, STRIPE_API_VERSION } from '@synapsedesk/common';

/**
 * The Stripe SDK, and the ONE place the secret keys live.
 *
 * Wrapped rather than injected raw so three things exist in one place: the
 * signature verification, the plan catalog, and the decision that a missing key
 * is a degraded mode rather than a boot failure.
 *
 * **Missing keys degrade rather than crash**, which is deliberate and is the
 * opposite of how the other clients here behave. Every existing tenant is
 * grandfathered — no Stripe objects at all — and on the day this ships that is
 * all of them. A service that refused to boot without billing configured would
 * take down login for a system where billing is not yet in use.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);

  private client: Stripe | null = null;
  // `''` rather than `undefined`, and it is FAIL-CLOSED by construction: the
  // type stays non-nullable so no call site needs a guard, and an empty secret
  // makes `constructEvent` reject EVERY signature — so "not configured" behaves
  // as "no webhook is authentic". `undefined` would either widen the type or
  // throw further in, where it reads as a crash rather than a refusal.
  private webhookSecret = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';

    if (!secretKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is unset — billing endpoints will answer UNAVAILABLE and every tenant stays grandfathered',
      );
      return;
    }

    // **Pinned, not inherited.** Without an `apiVersion` the SDK follows
    // whatever the ACCOUNT default happens to be, so the same build talks two
    // different APIs across two environments — and a Stripe-side version bump
    // changes this service's behaviour with no deploy and no diff. The
    // provisioning script pins the same version for the same reason.
    this.client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Verifies the signature over the RAW BYTES and returns the event.
   *
   * The bytes have to be exactly what Stripe sent — see the note on
   * `StripeWebhookRequest` in the proto. If a JSON parser has touched them
   * anywhere between Stripe and here, this throws for every event, forever,
   * and entitlements silently stop tracking subscriptions while the app looks
   * entirely healthy.
   *
   * INVALID_ARGUMENT → 400 at the gateway, which is what Stripe expects for a
   * signature it cannot prove. Nothing is recorded: a `billing_events` row
   * means "we believed this and acted on it".
   */
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    // Gated on the WEBHOOK SECRET alone, not on the API key — and the
    // distinction is real rather than pedantic. Verification is a local HMAC;
    // it needs no network and no API credential. A deployment configured to
    // RECEIVE webhooks but not to CALL Stripe (a read replica, a region that
    // only writes entitlements) is a coherent setup, and requiring the API key
    // here would break it for no reason.
    if (!this.webhookSecret) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Billing is not configured on this deployment',
      });
    }

    try {
      // The STATIC interface, so this works whether or not an API client was
      // constructed.
      return Stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      // Logged at WARN, not ERROR. An unverifiable request is usually someone
      // probing the endpoint, and an ERROR per probe trains people to ignore
      // the log that also carries the real misconfiguration.
      this.logger.warn(
        `Rejected a Stripe webhook with an invalid signature: ${formatErrorMsg(error)}`,
      );

      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Stripe signature verification failed',
      });
    }
  }

  /** The SDK, or UNAVAILABLE — never a null dereference at a call site. */
  get api(): Stripe {
    if (!this.client) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Billing is not configured on this deployment',
      });
    }

    return this.client;
  }
}

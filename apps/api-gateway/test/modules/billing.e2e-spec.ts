import request from 'supertest';
import { of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoAiModelTier, toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError } from '../fixtures/wire';

describe('§3-§4 Billing at the gateway (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
    fx.stubs.organization.getOrganizationStatus.mockReturnValue(
      of({ status: toProtoOrgStatus(OrgStatus.ACTIVE), deleted: false }),
    );
  });

  afterAll(async () => {
    await fx.close();
  });

  // --------------------------------------------------- §3.2 the raw body

  describe('§3.2 the raw-body trap', () => {
    it('5. Hands the webhook the RAW BYTES, even with a global JSON parser registered', async () => {
      // **The single most common way this integration fails on first deploy**,
      // and it fails in the most expensive shape available: locally it often
      // works (fewer middleware layers), in production every webhook 400s, and
      // entitlements silently stop tracking subscriptions while the app looks
      // entirely healthy.
      //
      // The assertion is byte equality against a body whose JSON round trip is
      // NOT the identity — key order and spacing both differ from what
      // `JSON.stringify` would produce. A parsed-and-reserialized body would
      // arrive here looking perfectly valid and would fail Stripe's signature
      // check every time.
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'PROCESSED' }),
      );

      const raw = '{"z":1,  "a":{"nested":  true},"id":"evt_raw"}';

      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=deadbeef')
        .send(raw)
        .expect(200);

      const [sent] = fx.stubs.billing.handleStripeWebhook.mock.calls[0];
      expect(Buffer.from(sent.payload).toString('utf8')).toBe(raw);

      // And the round trip really is lossy, so the test above is not vacuous.
      expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    });

    it('5b. Forwards the Stripe-Signature header verbatim', async () => {
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'PROCESSED' }),
      );

      const signature = 't=1700000000,v1=abc123,v0=def456';

      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send('{"id":"evt_sig"}')
        .expect(200);

      const [sent] = fx.stubs.billing.handleStripeWebhook.mock.calls[0];
      expect(sent.signature).toBe(signature);
    });

    it('5c. Refuses a request with NO signature header, without calling the service', async () => {
      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .send('{"id":"evt_nosig"}')
        .expect(400);

      expect(fx.stubs.billing.handleStripeWebhook).not.toHaveBeenCalled();
    });

    it('4. Answers 400 when the signature does not verify', async () => {
      // Stripe's own signal that something is wrong with the CALLER. It is the
      // only non-2xx this endpoint produces — see the bypass test below.
      // `grpcError`, not `new RpcException`. What crosses a real gRPC hop is a
      // plain object carrying `code` and `details` — an `RpcException`
      // instance never survives the wire, so stubbing one would test the
      // filter against a shape it never sees in production.
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        throwError(() =>
          grpcError(
            status.INVALID_ARGUMENT,
            'Stripe signature verification failed',
          ),
        ),
      );

      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=wrong')
        .send('{"id":"evt_bad"}')
        .expect(400);
    });
  });

  // ------------------------------------------------- §3.3 the four bypasses

  describe('§3.3 what the webhook bypasses', () => {
    it('Accepts a request with NO Authorization header at all', async () => {
      // There is no JWT. The request is authenticated by Stripe's signature,
      // which is a STRONGER claim than a bearer token rather than a weaker one.
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'PROCESSED' }),
      );

      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=x')
        .send('{"id":"evt_noauth"}')
        .expect(200);
    });

    it('9. Reaches its handler even when the tenant lifecycle gate would refuse', async () => {
      // The gate reads `organizations.status`; this endpoint's job is to WRITE
      // it. A `SUSPENDED_PAST_DUE` tenant whose payment succeeds must be able
      // to receive the event that reactivates them — otherwise suspension is a
      // one-way door.
      //
      // The bypass is automatic (the interceptor passes through any request
      // with no identity), and that is exactly why it is asserted: it holds by
      // coincidence rather than by declaration, so a future global auth guard
      // would break it silently.
      fx.stubs.organization.getOrganizationStatus.mockReturnValue(
        of({ status: toProtoOrgStatus(OrgStatus.FROZEN), deleted: false }),
      );
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'PROCESSED' }),
      );

      await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=x')
        .send('{"id":"evt_frozen"}')
        .expect(200);
    });

    it('Survives a burst that would trip per-tenant rate limiting', async () => {
      // Throttling a retry storm drops events that Stripe is correctly
      // redelivering — and a dropped retry is an entitlement that never lands.
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'PROCESSED' }),
      );

      for (let attempt = 0; attempt < 25; attempt += 1) {
        await request(fx.app.getHttpServer())
          .post(`${API}/webhooks/stripe`)
          .set('Content-Type', 'application/json')
          .set('stripe-signature', 't=1,v1=x')
          .send(`{"id":"evt_burst_${attempt}"}`)
          .expect(200);
      }
    });

    it('Answers 200 for an event the writer could not apply', async () => {
      // Stripe retries on any non-2xx, so a 500 for an unmappable price id
      // would turn one config typo into an escalating retry storm carrying an
      // event that will never succeed.
      fx.stubs.billing.handleStripeWebhook.mockReturnValue(
        of({ status: 'FAILED' }),
      );

      const response = await request(fx.app.getHttpServer())
        .post(`${API}/webhooks/stripe`)
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=x')
        .send('{"id":"evt_failed"}')
        .expect(200);

      expect(response.body.data.status).toBe('FAILED');
    });
  });

  // ------------------------------------------------------- §4 /billing/*

  describe('§4 /billing', () => {
    it('Requires authentication', async () => {
      await request(fx.app.getHttpServer())
        .get(`${API}/billing/subscription`)
        .expect(401);
    });

    it('Requires organization.read for the subscription read', async () => {
      const response = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/billing/subscription`);

      expect(response.status).toBe(403);
    });

    it('Reaches billing while the tenant is SUSPENDED_PAST_DUE', async () => {
      // `OrgAccess.BILLING`, and it is the whole point of that access kind: a
      // tenant locked out of the page where they would pay their overdue
      // invoice is a lockout with no exit.
      fx.stubs.organization.getOrganizationStatus.mockReturnValue(
        of({
          status: toProtoOrgStatus(OrgStatus.SUSPENDED_PAST_DUE),
          deleted: false,
        }),
      );
      fx.stubs.billing.getSubscription.mockReturnValue(
        of({
          planName: 'Pro',
          maxAgentSeats: 25,
          maxStorageBytes: 100,
          monthlyAiTokenBudget: 100,
          aiModelTier: toProtoAiModelTier('QUALITY'),
          billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
          status: toProtoOrgStatus(OrgStatus.SUSPENDED_PAST_DUE),
        }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      }).get(`${API}/billing/subscription`);

      expect(response.status).toBe(200);
      expect(response.body.data.planName).toBe('Pro');
    });

    it('Maps an absent customer id to NULL rather than dropping the field', async () => {
      // The grandfathered tenant. A client that got no key at all could not
      // distinguish "no subscription" from "the gateway forgot to send it".
      fx.stubs.billing.getSubscription.mockReturnValue(
        of({
          planName: 'Free',
          maxAgentSeats: 10,
          maxStorageBytes: 100,
          monthlyAiTokenBudget: 100,
          aiModelTier: toProtoAiModelTier('FAST'),
          billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
          status: toProtoOrgStatus(OrgStatus.ACTIVE),
        }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      }).get(`${API}/billing/subscription`);

      expect(response.status).toBe(200);
      expect(response.body.data.stripeCustomerId).toBeNull();
      expect(response.body.data.planName).toBe('Free');
    });

    it('1. Creates a checkout session and writes nothing itself', async () => {
      fx.stubs.billing.createCheckoutSession.mockReturnValue(
        of({ url: 'https://checkout.stripe.test/session' }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.update'],
      })
        .post(`${API}/billing/checkout-session`)
        .send({
          priceId: 'price_pro_monthly',
          successUrl: 'https://app.test/ok',
          cancelUrl: 'https://app.test/no',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.url).toContain('checkout.stripe.test');
      // The gateway holds no entitlement state at all, which is what makes
      // "checkout grants nothing" structural here rather than a rule.
      expect(fx.stubs.organization.updateOrganization).not.toHaveBeenCalled();
    });

    it('Rejects a checkout redirect that is not an http(s) URL', async () => {
      // A `javascript:` or `data:` URL here would be handed back to a browser
      // by Stripe.
      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.update'],
      })
        .post(`${API}/billing/checkout-session`)
        .send({
          priceId: 'price_pro_monthly',
          successUrl: 'javascript:alert(1)',
          cancelUrl: 'https://app.test/no',
        });

      expect(response.status).toBe(400);
      expect(fx.stubs.billing.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('Requires organization.update for the portal, not merely read', async () => {
      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      })
        .post(`${API}/billing/portal-session`)
        .send({ returnUrl: 'https://app.test/settings' });

      expect(response.status).toBe(403);
    });
  });
});

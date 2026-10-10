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

describe('Billing at the gateway (e2e)', () => {
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

  // --------------------------------------------------- the raw body

  describe('The raw-body trap', () => {
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

  // ------------------------------------------------- the four bypasses

  describe('What the webhook bypasses', () => {
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

  // ------------------------------------------------------- /billing/*

  describe('/billing', () => {
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

  // --------------------------------------------------- the plan-change block

  describe('The plan-change block', () => {
    const PLAN = '99999999-9999-4999-8999-999999999999';
    const PRICE = 'price_starter_monthly';

    /** Auth's half: what it decided, and what it left for the gateway. */
    const preview = (overrides: Record<string, unknown> = {}) =>
      of({
        overLimit: [],
        narrowedDimensions: [],
        targetMaxStorageBytes: 5_368_709_120,
        targetMaxDocumentUploads: 100,
        planName: 'Starter',
        ...overrides,
      });

    const changer = () =>
      authenticatedAgent(fx.app, {
        permissionCodes: ['organization.update'],
      });

    beforeEach(() => {
      fx.stubs.billing.changePlan.mockReturnValue(
        of({
          planId: PLAN,
          planName: 'Starter',
          effectiveAt: { seconds: 1_780_000_000, nanos: 0 },
          creditIssued: true,
        }),
      );
    });

    it('4. **REFUSES when the usage leg cannot answer and storage narrows**', async () => {
      // The one test here whose failure mode is "the feature appears to work".
      // A report may degrade — `enrichWithUsage` drops the dimensions ingestion
      // owns when the leg fails, because a dry run is information. A GATE may
      // not: allowing the change with storage unchecked is precisely the
      // outcome the block exists to prevent, and it would look identical to a
      // change that passed.
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({ narrowedDimensions: ['storage'] }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        throwError(() => grpcError(status.UNAVAILABLE, 'ingestion is down')),
      );

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(503);
      expect(response.body.error).toContain('storage');
      // And nothing was changed on the way to failing.
      expect(fx.stubs.billing.changePlan).not.toHaveBeenCalled();
    });

    it('2. Refuses a seat overrun, and Stripe is never reached', async () => {
      // The refusal names what to reduce and by how much: the person who tried
      // is reading the response, which is why this is a 4xx rather than a
      // notification.
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({
          overLimit: ['maxAgentSeats: 12 in use, plan grants 10'],
        }),
      );

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('12 in use, plan grants 10');
      expect(fx.stubs.billing.changePlan).not.toHaveBeenCalled();
      // Seats are auth's to answer, so no usage leg is dialled for them.
      expect(fx.stubs.document.getStorageUsage).not.toHaveBeenCalled();
    });

    it('3. A change that WIDENS every dimension dials no usage RPC at all', async () => {
      // An upgrade stays one Stripe round trip and cannot be refused because an
      // unrelated service is down — which it would be, given test 4.
      fx.stubs.billing.previewPlanChange.mockReturnValue(preview());

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(200);
      expect(fx.stubs.document.getStorageUsage).not.toHaveBeenCalled();
      expect(fx.stubs.billing.changePlan).toHaveBeenCalled();
    });

    it('4b. Reads the TENANT-SCOPED usage RPC, never the cross-tenant one', async () => {
      // `GetPlatformUsage` takes `repeated organization_ids`, has no
      // server-side authorization and no tenant filter — it is held closed by
      // `SuperAdminGuard` on its single caller. This route is reachable by an
      // Org Admin, so routing the block through it would make a privilege
      // boundary depend on which ids the gateway happens to send.
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({ narrowedDimensions: ['storage'] }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({ usedBytes: 1, limitBytes: 10, documentCount: 1 }),
      );

      await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE })
        .expect(200);

      expect(fx.stubs.document.getStorageUsage).toHaveBeenCalled();
      expect(
        fx.stubs.ingestionPlatform.getPlatformUsage,
      ).not.toHaveBeenCalled();
    });

    it('11. **Compares against the TARGET plan grant, not the tenant’s current ceiling**', async () => {
      // `StorageUsageResponse.limit_bytes` is right there and means something
      // adjacent: the ceiling the tenant holds TODAY, resolved by ingestion
      // calling back into auth. Comparing against it would let every downgrade
      // through, because a tenant is almost never over their current limit —
      // that is what the enforcement points are for.
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({
          narrowedDimensions: ['storage'],
          targetMaxStorageBytes: 5_368_709_120,
        }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({
          usedBytes: 8_461_348_864,
          // Comfortably above what is used: reading THIS field allows the
          // change, and reading the target grant refuses it.
          limitBytes: 10_737_418_240,
          documentCount: 4,
        }),
      );

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain(
        'maxStorageBytes: 8461348864 used, plan grants 5368709120',
      );
      expect(fx.stubs.billing.changePlan).not.toHaveBeenCalled();
    });

    it('11b. …and a document-count overrun is refused on the same terms', async () => {
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({
          narrowedDimensions: ['documents'],
          targetMaxDocumentUploads: 100,
        }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({ usedBytes: 1, limitBytes: 10, documentCount: 140 }),
      );

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain(
        'maxDocumentUploads: 140 held, plan grants 100',
      );
    });

    it('11c. A narrowing change the tenant FITS goes through', async () => {
      // The other side of 11 and 11b: narrowing is not itself a refusal. A
      // block that refused every downgrade would pass both of those and be
      // useless.
      fx.stubs.billing.previewPlanChange.mockReturnValue(
        preview({ narrowedDimensions: ['storage', 'documents'] }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({ usedBytes: 1_000, limitBytes: 10_737_418_240, documentCount: 3 }),
      );

      await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE })
        .expect(200);

      expect(fx.stubs.billing.changePlan).toHaveBeenCalled();
    });

    it('12. Forwards the caller’s Idempotency-Key so a retry is ONE change', async () => {
      // `always_invoice` means a retried request is a second proration invoice
      // that looks legitimate at every layer. The header is the mechanism
      // because a plan change is not idempotent the way a payment is: two
      // identical requests a month apart are two legitimate changes.
      fx.stubs.billing.previewPlanChange.mockReturnValue(preview());

      await changer()
        .post(`${API}/billing/plan`)
        .set('Idempotency-Key', 'client-key-1')
        .send({ planId: PLAN, priceId: PRICE })
        .expect(200);

      const [sent] = fx.stubs.billing.changePlan.mock.calls[0];
      expect(sent.idempotencyKey).toBe('client-key-1');
    });

    it('**`creditIssued` is null when Stripe did not say**', async () => {
      // Three-valued on purpose. `always_invoice` does not guarantee the
      // proration lands on `latest_invoice` — Stripe may issue it as a customer
      // credit balance transaction — so a `false` can be wrong for a change
      // that credited, and a `true` can be read off an unrelated negative
      // invoice. `null` means "say nothing", which is the option a comment on a
      // plain boolean cannot give a UI that is already rendering it.
      fx.stubs.billing.previewPlanChange.mockReturnValue(preview());
      fx.stubs.billing.changePlan.mockReturnValue(
        of({
          planId: PLAN,
          planName: 'Starter',
          effectiveAt: { seconds: 1_780_000_000, nanos: 0 },
          // Absent on the wire — the writer could not determine it.
          creditIssued: undefined,
        }),
      );

      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE })
        .expect(200);

      expect(response.body.data.creditIssued).toBeNull();
    });

    it('Requires organization.update, not merely read', async () => {
      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      })
        .post(`${API}/billing/plan`)
        .send({ planId: PLAN, priceId: PRICE });

      expect(response.status).toBe(403);
      expect(fx.stubs.billing.previewPlanChange).not.toHaveBeenCalled();
    });

    it('Rejects a planId that is not a UUID before any service is called', async () => {
      const response = await changer()
        .post(`${API}/billing/plan`)
        .send({ planId: 'not-a-uuid', priceId: PRICE });

      expect(response.status).toBe(400);
      expect(fx.stubs.billing.previewPlanChange).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------- the usage meter

  describe('The usage meter', () => {
    it('13. **Reports storage with the SAME number a refusal would quote**', async () => {
      // auth-service returns this meter `available: false` — it cannot count
      // documents and cannot dial the service that does — and the gateway
      // fills it in. Left as auth sent it, a tenant refused with
      // `maxStorageBytes: 8461348864 used` would open the page that refusal
      // points at and read "document storage is not enabled for this
      // workspace": two answers to one question, minutes apart.
      fx.stubs.organization.getOrganizationUsage.mockReturnValue(
        of({
          seats: { available: true, used: 3, limit: 10 },
          storage: {
            available: false,
            unavailableReason: 'Storage usage is answered by ingestion-service',
          },
          aiTokens: { available: false, unavailableReason: 'not yet' },
          aiModelTier: toProtoAiModelTier('FAST'),
          planName: 'Pro',
          billingCycleStart: { seconds: 1_780_000_000, nanos: 0 },
        }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({
          usedBytes: 8_461_348_864,
          limitBytes: 53_687_091_200,
          documentCount: 12,
        }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      })
        .get(`${API}/organizations/current/usage`)
        .expect(200);

      expect(response.body.data.storage).toEqual({
        available: true,
        used: 8_461_348_864,
        limit: 53_687_091_200,
        unavailableReason: null,
      });
      // Seats still come from auth — the gateway composes, it does not count.
      expect(response.body.data.seats.used).toBe(3);
    });

    it('13b. …and a REPORT degrades where the gate refuses', async () => {
      // The deliberate asymmetry. An unreadable usage leg leaves this meter
      // unavailable with a reason rather than failing the page or reporting
      // zero bytes used — a zero would read as "you have used nothing", which
      // is a claim we cannot make. `POST /billing/plan` does the opposite and
      // refuses, because a block that fails open is not a block.
      fx.stubs.organization.getOrganizationUsage.mockReturnValue(
        of({
          seats: { available: true, used: 3, limit: 10 },
          storage: { available: false, unavailableReason: 'ingestion answers' },
          aiTokens: { available: false, unavailableReason: 'not yet' },
          aiModelTier: toProtoAiModelTier('FAST'),
          planName: 'Pro',
          billingCycleStart: { seconds: 1_780_000_000, nanos: 0 },
        }),
      );
      fx.stubs.document.getStorageUsage.mockReturnValue(
        throwError(() => grpcError(status.UNAVAILABLE, 'ingestion is down')),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      })
        .get(`${API}/organizations/current/usage`)
        .expect(200);

      expect(response.body.data.storage.available).toBe(false);
      expect(response.body.data.storage.used).toBeNull();
      // The page still renders, and seats are still answered.
      expect(response.body.data.seats.used).toBe(3);
    });
  });

  // --------------------------------------------------- the tenant catalogue

  describe('The tenant plan catalogue', () => {
    it('9. Carries no operator fields — no product id, no subscriber count', async () => {
      // The Super Admin projection carries `stripeProductId`, `deletedAt`,
      // `deletedById`, `isActive` and a subscriber count. Reusing that DTO
      // behind a looser guard is how those leak, and a Stripe product id in a
      // tenant response is the kind of identifier that turns up in a support
      // ticket.
      fx.stubs.billing.listTenantPlans.mockReturnValue(
        of({
          items: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Starter',
              maxAgentSeats: 10,
              maxStorageBytes: 5_368_709_120,
              monthlyAiTokenBudget: 1_000_000,
              aiModelTier: toProtoAiModelTier('FAST'),
              maxDocumentBytes: 10_485_760,
              maxAttachmentBytes: 10_485_760,
              maxDocumentUploads: 100,
              maxAnalyticsRangeDays: 30,
              prices: [
                { stripePriceId: 'price_starter_monthly', interval: 'month' },
              ],
            },
          ],
        }),
      );

      const response = await authenticatedAgent(fx.app, {
        permissionCodes: ['organization.read'],
      })
        .get(`${API}/billing/plans`)
        .expect(200);

      const [plan] = response.body.data as Record<string, unknown>[];

      expect(plan.name).toBe('Starter');
      expect(plan.prices).toEqual([
        { stripePriceId: 'price_starter_monthly', interval: 'month' },
      ]);

      for (const field of [
        'stripeProductId',
        'deletedAt',
        'deletedById',
        'isActive',
        'subscriberCount',
      ]) {
        expect(plan).not.toHaveProperty(field);
      }
    });
  });
});

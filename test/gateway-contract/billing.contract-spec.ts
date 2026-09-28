/**
 * @file `BillingApi` — `changePlan`'s usage-fit gate is the sharpest row
 * here: it must fail CLOSED (503) when ingestion cannot answer, never allow
 * a narrowed dimension through unchecked, and must not dial ingestion at
 * all for a widening change or a seat-only refusal.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('billing', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'dddddddd-1111-4111-8111-dddddddddddd';
  const USER = 'dddddddd-2222-4222-8222-dddddddddddd';

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Billing')(
    '**`getSubscription` maps the entitlements and status**',
    async () => {
      peers.auth.on('BillingService/GetSubscription').reply({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        planName: 'Pro',
        maxAgentSeats: 10,
        maxStorageBytes: '1000000000',
        monthlyAiTokenBudget: '5000000',
        aiModelTier: 'AI_MODEL_TIER_FAST',
        billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
        status: toProtoOrgStatus(OrgStatus.ACTIVE),
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/billing/subscription`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          stripeCustomerId: 'cus_123',
          planName: 'Pro',
          maxAgentSeats: 10,
        },
      });
    },
  );

  rowFor('Billing')(
    '**`createCheckoutSession` forwards the price and URLs, returns the Stripe URL**',
    async () => {
      peers.auth
        .on('BillingService/CreateCheckoutSession')
        .reply({ url: 'https://checkout.stripe.com/abc' });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/checkout-session`,
        {
          priceId: 'price_123',
          successUrl: 'https://app.test/success',
          cancelUrl: 'https://app.test/cancel',
        },
        headers(['organization.update']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { url: 'https://checkout.stripe.com/abc' },
      });
      const [call] = peers.auth.calls('BillingService/CreateCheckoutSession');
      expect(call.request).toMatchObject({
        priceId: 'price_123',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      });
    },
  );

  rowFor('Billing')(
    '**`createPortalSession` forwards the return URL**',
    async () => {
      peers.auth
        .on('BillingService/CreatePortalSession')
        .reply({ url: 'https://billing.stripe.com/xyz' });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/portal-session`,
        { returnUrl: 'https://app.test/settings' },
        headers(['organization.update']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { url: 'https://billing.stripe.com/xyz' },
      });
      const [call] = peers.auth.calls('BillingService/CreatePortalSession');
      expect(call.request).toMatchObject({
        returnUrl: 'https://app.test/settings',
      });
    },
  );

  rowFor('Billing')('**`listInvoices` forwards the limit**', async () => {
    peers.auth.on('BillingService/ListInvoices').reply({
      items: [
        {
          id: 'in_1',
          number: 'INV-1',
          amountDue: 1_000,
          currency: 'usd',
          status: 'paid',
          created: { seconds: 1_756_684_800, nanos: 0 },
          hostedInvoiceUrl: 'https://invoice.stripe.com/1',
        },
      ],
    });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/billing/invoices?limit=5`,
      headers(['organization.update']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ id: 'in_1', amountDue: 1000, status: 'paid' }],
    });
    const [call] = peers.auth.calls('BillingService/ListInvoices');
    expect(call.request).toMatchObject({ limit: 5 });
  });

  rowFor('Billing')(
    '**`listPlans` returns the tenant-visible catalogue with prices**',
    async () => {
      peers.auth.on('BillingService/ListTenantPlans').reply({
        items: [
          {
            id: 'plan_pro',
            name: 'Pro',
            maxAgentSeats: 10,
            maxStorageBytes: '1000000000',
            monthlyAiTokenBudget: '5000000',
            aiModelTier: 'AI_MODEL_TIER_FAST',
            maxDocumentBytes: '104857600',
            maxAttachmentBytes: '10485760',
            maxDocumentUploads: 1000,
            maxAnalyticsRangeDays: 90,
            prices: [{ stripePriceId: 'price_123', interval: 'month' }],
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/billing/plans`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [
          {
            id: 'plan_pro',
            name: 'Pro',
            prices: [{ stripePriceId: 'price_123', interval: 'month' }],
          },
        ],
      });
    },
  );

  rowFor('Billing')(
    '**`changePlan`: a widening change dials nothing else and reaches Stripe**',
    async () => {
      peers.auth.on('BillingService/PreviewPlanChange').reply({
        overLimit: [],
        narrowedDimensions: [],
        planName: 'Pro',
      });
      peers.auth.on('BillingService/ChangePlan').reply({
        planId: 'plan_pro',
        planName: 'Pro',
        effectiveAt: { seconds: 1_756_684_800, nanos: 0 },
        creditIssued: false,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '11111111-1111-4111-8111-111111111111',
          priceId: 'price_123',
        },
        {
          ...headers(['organization.update']),
          'idempotency-key': 'idem-widen',
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Plan change submitted',
        data: { planId: 'plan_pro' },
      });
      const [call] = peers.auth.calls('BillingService/ChangePlan');
      expect(call.request).toMatchObject({ idempotencyKey: 'idem-widen' });
    },
  );

  rowFor('Billing')(
    '**`changePlan`: an over-limit seat count refuses without dialing ingestion**',
    async () => {
      peers.auth.on('BillingService/PreviewPlanChange').reply({
        overLimit: ['maxAgentSeats: 12 in use, plan grants 10'],
        narrowedDimensions: [],
        planName: 'Starter',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '22222222-1111-4111-8111-222222222222',
          priceId: 'price_starter',
        },
        {
          ...headers(['organization.update']),
          'idempotency-key': 'idem-seats',
        },
      );

      expect(response.status).toBe(400);
      expect(peers.auth.calls('BillingService/ChangePlan')).toHaveLength(0);
      expect(
        peers.ingestion.calls('DocumentService/GetStorageUsage'),
      ).toHaveLength(0);
    },
  );

  rowFor('Billing')(
    '**`changePlan`: usage within the target grant is allowed**',
    async () => {
      peers.auth.on('BillingService/PreviewPlanChange').reply({
        overLimit: [],
        narrowedDimensions: ['storage'],
        targetMaxStorageBytes: '1000000000',
        planName: 'Starter',
      });
      peers.ingestion.on('DocumentService/GetStorageUsage').reply({
        usedBytes: '500000000',
        limitBytes: '2000000000',
        documentCount: 4,
      });
      peers.auth.on('BillingService/ChangePlan').reply({
        planId: 'plan_starter',
        planName: 'Starter',
        effectiveAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '33333333-1111-4111-8111-333333333333',
          priceId: 'price_starter',
        },
        { ...headers(['organization.update']), 'idempotency-key': 'idem-fits' },
      );

      expect(response.status).toBe(200);
    },
  );

  rowFor('Billing')(
    '**`changePlan`: usage over the target grant refuses before Stripe is touched**',
    async () => {
      peers.auth.on('BillingService/PreviewPlanChange').reply({
        overLimit: [],
        narrowedDimensions: ['storage'],
        targetMaxStorageBytes: '1000000000',
        planName: 'Starter',
      });
      peers.ingestion.on('DocumentService/GetStorageUsage').reply({
        usedBytes: '5000000000',
        limitBytes: '10000000000',
        documentCount: 4,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '44444444-1111-4111-8111-444444444444',
          priceId: 'price_starter',
        },
        {
          ...headers(['organization.update']),
          'idempotency-key': 'idem-overusage',
        },
      );

      expect(response.status).toBe(400);
      expect(peers.auth.calls('BillingService/ChangePlan')).toHaveLength(0);
    },
  );

  rowFor('Billing')(
    '**`changePlan`: an unreadable usage leg refuses (503), never allows the dimension through unchecked**',
    async () => {
      peers.auth.on('BillingService/PreviewPlanChange').reply({
        overLimit: [],
        narrowedDimensions: ['documents'],
        targetMaxDocumentUploads: 100,
        planName: 'Starter',
      });
      peers.ingestion
        .on('DocumentService/GetStorageUsage')
        .fail(GrpcStatus.UNAVAILABLE, 'ingestion unavailable');

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '55555555-1111-4111-8111-555555555555',
          priceId: 'price_starter',
        },
        {
          ...headers(['organization.update']),
          'idempotency-key': 'idem-unverifiable',
        },
      );

      expect(response.status).toBe(503);
      expect(peers.auth.calls('BillingService/ChangePlan')).toHaveLength(0);
    },
  );

  rowFor('Billing')(
    '**`changePlan` succeeds without an `Idempotency-Key` header**',
    async () => {
      peers.auth
        .on('BillingService/PreviewPlanChange')
        .reply({ overLimit: [], narrowedDimensions: [], planName: 'Pro' });
      peers.auth.on('BillingService/ChangePlan').reply({
        planId: 'plan_pro',
        planName: 'Pro',
        effectiveAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/billing/plan`,
        {
          planId: '66666666-1111-4111-8111-666666666666',
          priceId: 'price_123',
        },
        headers(['organization.update']),
      );

      expect(response.status).toBe(200);
    },
  );
});

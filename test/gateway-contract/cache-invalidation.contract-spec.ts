/**
 * @file The NATS cache-invalidation consumer. Closes known gap 42: the Java
 * gateway used to write the shared `cache:` keyspace and evict nothing.
 *
 * Warmed and verified through Redis DIRECTLY, via `ioredis` — not through an
 * HTTP round trip. Two of the four scopes this consumer drops
 * (`tickets`, `settings`) have no real cached ROUTE in either gateway today
 * (`CacheServiceIT`'s own precedent: "Neither gateway caches a real route
 * yet" for several scopes), so a route-shaped proof would only work for two
 * of the four. Redis is exactly as external as the NATS broker this file
 * also connects to directly — reaching into shared infrastructure, not into
 * either gateway's process.
 */

import { connect, JSONCodec, type NatsConnection } from 'nats';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import {
  BILLING_PATTERNS,
  DOCUMENT_PATTERNS,
  OrgStatus,
  TICKET_PATTERNS,
} from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { IMPL } from './pending';

const ORGANIZATION = '99999999-9999-4999-8999-999999999999';
const SETTLE_MS = 800;

const cacheKey = (scope: string) => `cache:${ORGANIZATION}|${scope}|`;

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const headers = () => ({
  cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
    {
      sub: '88888888-8888-4888-8888-888888888888',
      organizationId: ORGANIZATION,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: [],
      isEmailVerified: true,
    },
    TEST_KEYS.access(),
    { algorithm: 'RS256', expiresIn: '15m' },
  )}`,
});

const wireOrganization = () => ({
  id: ORGANIZATION,
  name: 'Acme',
  slug: 'acme',
  status: toProtoOrgStatus(OrgStatus.ACTIVE),
  enforceTwoFactor: false,
  allowedEmailDomains: [],
  maxAgentSeats: 10,
  maxStorageBytes: '1000000000',
  monthlyAiTokenBudget: '5000000',
  aiModelTier: 'AI_MODEL_TIER_FAST',
  billingCycleStart: { seconds: 1_756_684_800, nanos: 0 },
  maxDocumentBytes: '104857600',
  maxAttachmentBytes: '10485760',
  maxDocumentUploads: 100,
  maxAnalyticsRangeDays: 90,
  createdAt: { seconds: 1_756_684_800, nanos: 0 },
  updatedAt: { seconds: 1_756_684_800, nanos: 0 },
});

describe('cache invalidation — one gateway, the four scope-drop rules', () => {
  let peers: Peers;
  let gateway: Gateway;
  let nats: NatsConnection;
  let redis: Redis;

  const publish = (subject: string, event: Record<string, unknown>) => {
    nats.publish(
      subject,
      JSONCodec().encode({ pattern: subject, data: event }),
    );
  };

  const warm = async (scope: string) => {
    await redis.set(cacheKey(scope), '"warm"', 'EX', 60);
  };

  const isWarm = async (scope: string) =>
    (await redis.exists(cacheKey(scope))) === 1;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
    nats = await connect({ servers: natsUrl });
    redis = new Redis(redisUrl);
  }, 90_000);

  afterAll(async () => {
    await nats?.drain();
    redis?.disconnect();
    await gateway?.stop();
    await peers?.stop();
  });

  beforeEach(async () => {
    await redis.del(
      cacheKey('tickets'),
      cacheKey('documents'),
      cacheKey('settings'),
      cacheKey('organizations'),
    );
  });

  it("**a `ticket.*` event drops the tenant's `tickets` scope**", async () => {
    await warm('tickets');
    publish(TICKET_PATTERNS.created, {
      organizationId: ORGANIZATION,
      ticketId: '11111111-1111-4111-8111-111111111111',
      occurredAt: new Date().toISOString(),
      ticketNumber: 1,
      authorId: '22222222-2222-4222-8222-222222222222',
      source: 1,
      title: 'Printer is on fire',
    });
    await nats.flush();
    await settle();

    expect(await isWarm('tickets')).toBe(false);
  });

  it('**`billing.entitlements_changed` drops `settings` AND `organizations`, asserted separately**', async () => {
    await warm('settings');
    await warm('organizations');
    publish(BILLING_PATTERNS.entitlementsChanged, {
      organizationId: ORGANIZATION,
    });
    await nats.flush();
    await settle();

    expect(await isWarm('settings')).toBe(false);
    expect(await isWarm('organizations')).toBe(false);
  });

  it('**`document.uploaded` drops nothing — the deliberate absence**', async () => {
    await warm('documents');
    publish(DOCUMENT_PATTERNS.uploaded, {
      organizationId: ORGANIZATION,
      documentId: '33333333-3333-4333-8333-333333333333',
    });
    await nats.flush();
    await settle();

    // Not vacuous: the same mechanism, on a SIBLING document event, does drop it.
    expect(await isWarm('documents')).toBe(true);
    publish(DOCUMENT_PATTERNS.indexed, {
      organizationId: ORGANIZATION,
      documentId: '33333333-3333-4333-8333-333333333333',
    });
    await nats.flush();
    await settle();

    expect(await isWarm('documents')).toBe(false);
  });

  it('**a tenantless event is logged and the consumer survives** — a good event right after still evicts', async () => {
    await warm('tickets');
    // No `organizationId` at all.
    nats.publish(
      TICKET_PATTERNS.created,
      JSONCodec().encode({
        pattern: TICKET_PATTERNS.created,
        data: { ticketId: '44444444-4444-4444-8444-444444444444' },
      }),
    );
    await nats.flush();
    await settle();

    // Survived: the scope this bad event WOULD have targeted is still warm,
    // and the consumer is still alive to process the next one.
    expect(await isWarm('tickets')).toBe(true);

    publish(TICKET_PATTERNS.created, {
      organizationId: ORGANIZATION,
      ticketId: '55555555-5555-4555-8555-555555555555',
      occurredAt: new Date().toISOString(),
      ticketNumber: 2,
      authorId: '22222222-2222-4222-8222-222222222222',
      source: 1,
      title: 'Still on fire',
    });
    await nats.flush();
    await settle();

    expect(await isWarm('tickets')).toBe(false);
  });
});

describe('cache invalidation — active vs. standby, cross-implementation', () => {
  const OTHER_IMPL = IMPL === 'java' ? 'node' : 'java';

  let peers: Peers;
  let active: Gateway;
  let standby: Gateway;
  let nats: NatsConnection;
  let redis: Redis;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    peers.auth
      .on('OrganizationService/GetCurrentOrganization')
      .always(wireOrganization());

    const env = { ...peers.env, REDIS_URL: redisUrl, NATS_URL: natsUrl };

    // The OTHER implementation, started FIRST so it claims the lease alone —
    // it becomes the ACTIVE side, `startGateway`'s default readiness probe
    // proves it (the lease's own claim is what `/health/ready` gates on).
    active = await startGateway(env, { impl: OTHER_IMPL });

    // THIS arm, started second: the lease is already held by the other
    // implementation, so this one can only ever answer 503 on `/health/ready`
    // — `probe: 'live'` is what lets `startGateway` return without waiting
    // for a readiness that will not come while `active` holds the lease.
    standby = await startGateway(env, { impl: IMPL, probe: 'live' });

    nats = await connect({ servers: natsUrl });
    redis = new Redis(redisUrl);
  }, 120_000);

  afterAll(async () => {
    await nats?.drain();
    redis?.disconnect();
    await standby?.stop();
    await active?.stop();
    await peers?.stop();
  });

  it('**a standby holds no subscription — its own `/health/ready` proves it, structurally**', async () => {
    const response = await fetch(`${standby.baseUrl}/health/ready`);

    expect(response.status).toBe(503);
  });

  it(`**cross-implementation: the ACTIVE (${OTHER_IMPL}) side evicts what the STANDBY (${IMPL}) cached**`, async () => {
    await redis.del(cacheKey('organizations'));

    // Warmed through THIS arm's own HTTP surface — a standby still answers
    // ordinary requests; only its NATS consumer and its readiness are gated.
    const response = await new Session(standby.baseUrl).get(
      `${API}/organizations/current`,
      headers(),
    );
    expect(response.status).toBe(200);
    expect(await redis.exists(cacheKey('organizations'))).toBe(1);

    nats.publish(
      BILLING_PATTERNS.entitlementsChanged,
      JSONCodec().encode({
        pattern: BILLING_PATTERNS.entitlementsChanged,
        data: { organizationId: ORGANIZATION },
      }),
    );
    await nats.flush();
    await settle();

    // Only `active` (the OTHER implementation) has a live consumer — this
    // eviction cannot be attributed to `standby`, which row above proves has
    // none.
    expect(await redis.exists(cacheKey('organizations'))).toBe(0);
  });
});

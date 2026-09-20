/**
 * @file Pagination, GraphQL and the webhook edges.
 *
 * The three surfaces a client reaches that are not a plain REST route: a list
 * with its `PaginationResponseDto`, the GraphQL endpoint (which is NOT under
 * the API prefix and formats its own errors), and the two webhooks, whose
 * contract at the gateway is that the RAW body reaches the peer unchanged —
 * a signature is computed over bytes, so a gateway that re-serialised the JSON
 * would break verification without changing a single visible field.
 */

import { createHmac } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';

describe('pagination, GraphQL and the webhooks', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '99999999-9999-4999-8999-999999999999';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

  it('**a list carries the pagination envelope**, and the query reaches the peer', async () => {
    peers.auth.on('RoleService/ListRoles').reply({
      items: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Agent',
          description: 'Front line',
          isSystem: false,
          permissionCodes: ['ticket.read.own'],
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
          updatedAt: { seconds: 1_756_684_800, nanos: 0 },
        },
      ],
      meta: {
        totalItems: 11,
        itemCount: 1,
        itemsPerPage: 10,
        totalPages: 2,
        currentPage: 2,
      },
    });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/roles?page=2&limit=10`,
      headers(['role.read']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        meta: {
          totalItems: 11,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 2,
          currentPage: 2,
        },
      },
    });

    const [call] = peers.auth.calls('RoleService/ListRoles');
    // The query DTO travels as the proto's own `page` message — the shape a
    // Java gateway has to build too, not a flattened pair.
    expect(call.request).toMatchObject({ page: { page: 2, limit: 10 } });
  });

  it('a page past the bounds is refused as a 400, not clamped', async () => {
    const response = await new Session(gateway.baseUrl).get(
      `${API}/roles?page=0`,
      headers(['role.read']),
    );

    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('page');
  });

  it('**GraphQL answers on `/graphql`**, outside the API prefix', async () => {
    peers.auth.on('UserService/GetCurrentUser').reply({
      user: {
        id: USER,
        organizationId: ORGANIZATION,
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        isEmailVerified: true,
        isPhoneVerified: false,
        isLocked: false,
        isTwoFactorEnabled: false,
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
        updatedAt: { seconds: 1_756_684_800, nanos: 0 },
      },
      permissionCodes: ['role.read'],
      departmentIds: [],
    });

    const response = await new Session(gateway.baseUrl).post(
      '/graphql',
      { query: '{ me { id email } }' },
      headers(['role.read']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { me: { id: USER, email: 'ada@example.com' } },
    });
  });

  it('a GraphQL query the schema does not have is a GraphQL error, not a 404', async () => {
    const response = await new Session(gateway.baseUrl).post(
      '/graphql',
      { query: '{ noSuchField }' },
      headers(),
    );

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('errors');
  });

  it('**the Stripe webhook forwards the RAW bytes and the signature**', async () => {
    // The signature is computed over the exact body Stripe sent; the gateway
    // buffers it (`rawBody: true`) and hands both to the peer, which verifies.
    // A gateway that re-serialised the JSON would break verification while
    // every visible field stayed the same.
    peers.auth.on('BillingService/HandleStripeWebhook').reply({ status: 'ok' });

    const payload = '{"id":"evt_contract","type":"invoice.paid"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'whsec_contract_harness') // NOSONAR
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const response = await fetch(`${gateway.baseUrl}${API}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    });

    expect(response.status).toBe(200);

    const [call] = peers.auth.calls('BillingService/HandleStripeWebhook');
    expect(Buffer.from(call.request.payload as Uint8Array).toString()).toBe(
      payload,
    );
    expect(call.request.signature).toBe(`t=${timestamp},v1=${signature}`);
  });

  it('…and refuses the same body with no signature header, before the peer', async () => {
    const response = await fetch(`${gateway.baseUrl}${API}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"id":"evt_contract"}',
    });

    expect(response.status).toBe(400);
    expect(peers.auth.calls('BillingService/HandleStripeWebhook')).toHaveLength(
      0,
    );
  });

  it('**the Resend webhook refuses an unsigned delivery** with 401', async () => {
    const response = await fetch(
      `${gateway.baseUrl}${API}/webhooks/email/resend`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'email.received', data: {} }),
      },
    );

    expect(response.status).toBe(401);
  });
});

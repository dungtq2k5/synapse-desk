/**
 * @file `WebhookEndpointsApi` — outbound webhook management. The secret is
 * the sharpest property (only `create`/`rotateSecret` ever carry it); the
 * route-ordering row proves `event-types` is never swallowed as an `:id`.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('webhook-endpoints', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';
  const USER = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';

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

  const wireEndpoint = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    url: 'https://example.com/hook',
    eventTypes: ['NOTIFICATION_TYPE_TICKET_ASSIGNED'],
    isActive: true,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
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

  rowFor('Webhook endpoints')('**`list` never carries a secret**', async () => {
    peers.notification
      .on('NotificationService/ListWebhookEndpoints')
      .reply({ items: [wireEndpoint('ep-1')] });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/webhook-endpoints`,
      headers(['organization.read']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { items: [{ id: 'ep-1' }] } });
    expect(response.text).not.toContain('secret');
  });

  rowFor('Webhook endpoints')(
    '**an auto-disabled endpoint answers why as data: `disabledCode` and `consecutiveFailures`**',
    async () => {
      peers.notification.on('NotificationService/ListWebhookEndpoints').reply({
        items: [
          {
            ...wireEndpoint('ep-1'),
            isActive: false,
            disabledReason:
              'Auto-disabled after 10 consecutive failed deliveries',
            disabledCode: 'WEBHOOK_DISABLED_CODE_CONSECUTIVE_FAILURES',
            consecutiveFailures: 10,
          },
          wireEndpoint('ep-2'),
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/webhook-endpoints`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(
        (
          response.body as {
            data: {
              items: { disabledCode: unknown; consecutiveFailures: unknown }[];
            };
          }
        ).data.items.map((item) => [
          item.disabledCode,
          item.consecutiveFailures,
        ]),
      ).toEqual([
        ['CONSECUTIVE_FAILURES', 10],
        [null, 0],
      ]);
    },
  );

  rowFor('Webhook endpoints')(
    '**`event-types` is never swallowed as an `:id` — declared first**',
    async () => {
      peers.notification.on('NotificationService/ListWebhookEventTypes').reply({
        types: [
          'NOTIFICATION_TYPE_TICKET_ASSIGNED',
          'NOTIFICATION_TYPE_WEBHOOK_ENDPOINT_DISABLED',
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/webhook-endpoints/event-types`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { types: ['ticket.assigned', 'webhook.endpoint_disabled'] },
      });
      expect(
        peers.notification.calls('NotificationService/GetWebhookEndpoint'),
      ).toHaveLength(0);
    },
  );

  rowFor('Webhook endpoints')(
    '**`get` returns one endpoint, still no secret**',
    async () => {
      const id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
      peers.notification
        .on('NotificationService/GetWebhookEndpoint')
        .reply(wireEndpoint(id));

      const response = await new Session(gateway.baseUrl).get(
        `${API}/webhook-endpoints/${id}`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { id } });
      expect(response.text).not.toContain('secret');
    },
  );

  rowFor('Webhook endpoints')(
    '**`create` is the one place the secret appears**',
    async () => {
      peers.notification.on('NotificationService/CreateWebhookEndpoint').reply({
        endpoint: wireEndpoint('cccccccc-1111-4111-8111-cccccccccccc'),
        secret: 'whsec_abc123',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/webhook-endpoints`,
        { url: 'https://example.com/hook', eventTypes: ['ticket.assigned'] },
        headers(['organization.update']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        data: {
          secret: 'whsec_abc123',
          endpoint: { id: 'cccccccc-1111-4111-8111-cccccccccccc' },
        },
      });
      const [call] = peers.notification.calls(
        'NotificationService/CreateWebhookEndpoint',
      );
      expect(call.request).toMatchObject({
        url: 'https://example.com/hook',
        eventTypes: [1],
      }); // NOTIFICATION_TYPE_TICKET_ASSIGNED
    },
  );

  rowFor('Webhook endpoints')(
    '**a `url` over 2000 characters is refused at the door, on create and on update — `maxLength` is the published contract**',
    async () => {
      const tooLong = `https://example.com/${'a'.repeat(2000)}`;
      const id = 'dddddddd-1111-4111-8111-dddddddddddd';

      const created = await new Session(gateway.baseUrl).post(
        `${API}/webhook-endpoints`,
        { url: tooLong, eventTypes: ['ticket.assigned'] },
        headers(['organization.update']),
      );
      const updated = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/webhook-endpoints/${id}`,
        { body: { url: tooLong }, headers: headers(['organization.update']) },
      );

      expect(created.status).toBe(400);
      expect(updated.status).toBe(400);
      // Refused before the peer: a length the contract forbids is never forwarded.
      expect(
        peers.notification.calls('NotificationService/CreateWebhookEndpoint'),
      ).toHaveLength(0);
      expect(
        peers.notification.calls('NotificationService/UpdateWebhookEndpoint'),
      ).toHaveLength(0);
    },
  );

  rowFor('Webhook endpoints')(
    '**`update` leaves subscriptions untouched when `eventTypes` is absent from the body**',
    async () => {
      const id = 'dddddddd-1111-4111-8111-dddddddddddd';
      peers.notification
        .on('NotificationService/UpdateWebhookEndpoint')
        .reply(wireEndpoint(id, { isActive: false }));

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/webhook-endpoints/${id}`,
        {
          body: { isActive: false },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.notification.calls(
        'NotificationService/UpdateWebhookEndpoint',
      );
      expect(call.request).not.toHaveProperty('eventTypes');
      expect(call.request).toMatchObject({ isActive: false });
    },
  );

  rowFor('Webhook endpoints')(
    '**`update` refuses an explicit empty `eventTypes: []` — the same minimum-one rule as `create`, never reaching the peer**',
    async () => {
      const id = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/webhook-endpoints/${id}`,
        {
          body: { eventTypes: [] },
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(400);
      expect(
        peers.notification.calls('NotificationService/UpdateWebhookEndpoint'),
      ).toHaveLength(0);
    },
  );

  rowFor('Webhook endpoints')(
    '**`delete` reports whether the row was removed**',
    async () => {
      const id = 'ffffffff-1111-4111-8111-ffffffffffff';
      peers.notification
        .on('NotificationService/DeleteWebhookEndpoint')
        .reply({ deleted: true });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/webhook-endpoints/${id}`,
        {
          headers: headers(['organization.update']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { deleted: true } });
    },
  );

  rowFor('Webhook endpoints')(
    '**`rotateSecret` is the other place the secret appears**',
    async () => {
      const id = '11111111-9999-4999-8999-111111111111';
      peers.notification.on('NotificationService/RotateWebhookSecret').reply({
        endpoint: wireEndpoint(id),
        secret: 'whsec_new456',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/webhook-endpoints/${id}/rotate-secret`,
        undefined,
        headers(['organization.update']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ data: { secret: 'whsec_new456' } });
    },
  );

  rowFor('Webhook endpoints')(
    '**`test` goes through the real delivery path**',
    async () => {
      const id = '22222222-9999-4999-8999-222222222222';
      peers.notification
        .on('NotificationService/TestWebhookEndpoint')
        .reply({ delivered: true, responseStatus: 200 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/webhook-endpoints/${id}/test`,
        undefined,
        headers(['organization.update']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        data: { delivered: true, responseStatus: 200 },
      });
    },
  );

  rowFor('Webhook endpoints')(
    '**`listDeliveries` forwards the limit, newest first**',
    async () => {
      const id = '33333333-9999-4999-8999-333333333333';
      peers.notification.on('NotificationService/ListWebhookDeliveries').reply({
        items: [
          {
            id: 'del-1',
            eventId: 'evt-1',
            eventType: 'ticket.assigned',
            status: 'WEBHOOK_DELIVERY_STATUS_DELIVERED',
            attempts: 1,
            occurredAt: { seconds: 1_756_684_800, nanos: 0 },
          },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/webhook-endpoints/${id}/deliveries?limit=25`,
        headers(['organization.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ id: 'del-1', status: 'DELIVERED' }] },
      });
      const [call] = peers.notification.calls(
        'NotificationService/ListWebhookDeliveries',
      );
      expect(call.request).toMatchObject({ endpointId: id, limit: 25 });
    },
  );
});

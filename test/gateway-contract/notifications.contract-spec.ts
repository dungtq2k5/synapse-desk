/**
 * @file `NotificationsApi` — the personal inbox. No `PermissionGuard`
 * anywhere in this module: the recipient is the caller's own id, carried in
 * gRPC metadata, and no request shape can name a different one. That makes
 * the caller-context metadata the actual security boundary here, not an
 * annotation — the row below reads what the peer received, not just what
 * the response says.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('notifications', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  const accessToken = () =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
  });

  const wireNotification = () => ({
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: ORGANIZATION,
    type: 1, // NOTIFICATION_TYPE_TICKET_ASSIGNED
    priority: 2, // NOTIFICATION_PRIORITY_NORMAL
    title: 'Ticket #42 assigned to you',
    data: '{"ticketId":"42"}',
    resourceType: 1, // NOTIFICATION_RESOURCE_TYPE_TICKET
    groupCount: 1,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
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

  rowFor('Notifications')(
    '**the caller is scoped by metadata, not by any request field** — `user_id` reaches the peer',
    async () => {
      peers.notification.on('NotificationService/ListNotifications').reply({
        items: [wireNotification()],
        hasMore: false,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/notifications`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ type: 'ticket.assigned', priority: 'NORMAL' }] },
      });

      const [call] = peers.notification.calls(
        'NotificationService/ListNotifications',
      );
      // No field on the request names a user — this is the ONLY thing that
      // keeps the feed self-scoped, since the module has no permission check.
      expect(call.metadata.user_id).toBe(USER);
    },
  );

  rowFor('Notifications')(
    'the feed parses the JSON data payload back into an object',
    async () => {
      peers.notification.on('NotificationService/ListNotifications').reply({
        items: [wireNotification()],
        hasMore: false,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/notifications`,
        cookie(),
      );

      expect(response.body).toMatchObject({
        data: { items: [{ data: { ticketId: '42' } }] },
      });
    },
  );

  rowFor('Notifications')(
    '**unread count reuses the feed request shape**, forced to `unreadOnly, limit=0`',
    async () => {
      peers.notification
        .on('NotificationService/GetUnreadCount')
        .reply({ count: 7 });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/notifications/unread-count`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { count: 7 } });

      const [call] = peers.notification.calls(
        'NotificationService/GetUnreadCount',
      );
      expect(call.request).toMatchObject({
        unreadOnly: true,
        includeArchived: false,
        limit: 0,
      });
    },
  );

  rowFor('Notifications')(
    'preferences round-trip the `*` wildcard type',
    async () => {
      peers.notification.on('NotificationService/ListPreferences').reply({
        items: [
          { type: '*', channel: 2, isEnabled: true, digest: 1, source: 3 },
        ],
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/notifications/preferences`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [
          {
            type: '*',
            channel: 'EMAIL',
            digest: 'IMMEDIATE',
            source: 'DEFAULT',
          },
        ],
      });
    },
  );

  rowFor('Notifications')(
    'updating a preference with no `digest` leaves the caller’s existing digest choice alone',
    async () => {
      peers.notification.on('NotificationService/UpdatePreference').reply({
        type: 'ticket.assigned',
        channel: 1,
        isEnabled: false,
        digest: 2,
        source: 1,
      });

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/notifications/preferences`,
        {
          body: {
            type: 'ticket.assigned',
            channel: 'IN_APP',
            isEnabled: false,
          },
          headers: cookie(),
        },
      );

      expect(response.status).toBe(200);

      const [call] = peers.notification.calls(
        'NotificationService/UpdatePreference',
      );
      // UNSPECIFIED (0), the proto zero value — "the client did not send
      // one" — never a channel-specific default the gateway invented.
      expect(call.request.digest).toBe(0);
    },
  );

  rowFor('Notifications')(
    'registering a device never echoes the token back',
    async () => {
      peers.notification.on('NotificationService/RegisterDevice').reply({
        id: '66666666-6666-4666-8666-666666666666',
        platform: 1,
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/notifications/devices`,
        { token: 'fcm-token-abc123', platform: 'IOS' },
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { platform: 'IOS' } });
      expect(JSON.stringify(response.body)).not.toContain('fcm-token-abc123');
    },
  );

  rowFor('Notifications')('forgetting a device is a real 204', async () => {
    peers.notification
      .on('NotificationService/ForgetDevice')
      .reply({ forgotten: true });

    const response = await new Session(gateway.baseUrl).request(
      'DELETE',
      `${API}/notifications/devices/66666666-6666-4666-8666-666666666666`,
      { headers: cookie() },
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
  });

  rowFor('Notifications')(
    'marking many read forwards either shape — ids, or a resource',
    async () => {
      peers.notification
        .on('NotificationService/MarkManyRead')
        .reply({ updated: 3, unreadCount: 4 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/notifications/read`,
        {
          resourceType: 'TICKET',
          resourceId: '77777777-7777-4777-8777-777777777777',
        },
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { updated: 3, unreadCount: 4 },
      });

      const [call] = peers.notification.calls(
        'NotificationService/MarkManyRead',
      );
      expect(call.request).toMatchObject({
        resourceType: 1,
        resourceId: '77777777-7777-4777-8777-777777777777',
      });
    },
  );

  rowFor('Notifications')(
    'archive is idempotent-shaped — 200, not a 409, on a re-archive',
    async () => {
      peers.notification
        .on('NotificationService/Archive')
        .reply({ updated: 1, unreadCount: 0 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/notifications/55555555-5555-4555-8555-555555555555/archive`,
        {},
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { updated: 1 } });
    },
  );
});

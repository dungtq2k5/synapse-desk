/**
 * @file `AttachmentsApi` — a top-level `/attachments/*` prefix, against
 * ticket-service's `MessageService`. No new gRPC infrastructure: reuses the
 * channel/stub `Chat` already pays for.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('attachments', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const ATTACHMENT = '33333333-3333-4333-8333-333333333333';

  const accessToken = (permissionCodes: string[] = []) =>
    sign(
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
    );

  const cookie = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(permissionCodes)}`,
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

  rowFor('Attachments')(
    '**download is open** — no permission, ticket-service resolves visibility',
    async () => {
      peers.ticket.on('MessageService/DownloadAttachment').reply({
        downloadUrl: 'https://storage.test/read/attachment-abc',
        expiresAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/attachments/${ATTACHMENT}/download`,
        cookie([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { downloadUrl: 'https://storage.test/read/attachment-abc' },
      });

      const [call] = peers.ticket.calls('MessageService/DownloadAttachment');
      expect(call.request).toMatchObject({ attachmentId: ATTACHMENT });
    },
  );

  rowFor('Attachments')(
    '**removing refuses a caller without `ticket.message.moderate`**',
    async () => {
      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/attachments/${ATTACHMENT}`,
        { headers: cookie([]) },
      );

      expect(response.status).toBe(403);
      expect(
        peers.ticket.calls('MessageService/DeleteAttachment'),
      ).toHaveLength(0);
    },
  );

  rowFor('Attachments')(
    'a caller WITH `ticket.message.moderate` hard-deletes the attachment (204)',
    async () => {
      peers.ticket.on('MessageService/DeleteAttachment').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/attachments/${ATTACHMENT}`,
        { headers: cookie(['ticket.message.moderate']) },
      );

      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      const [call] = peers.ticket.calls('MessageService/DeleteAttachment');
      expect(call.request).toMatchObject({ attachmentId: ATTACHMENT });
    },
  );
});

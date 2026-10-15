/**
 * @file `MessagesApi` — 7 of 8 routes are deliberately ungated (a caller
 * with ZERO permission codes still reaches them, since the thread is how an
 * end user talks to support); `redact` alone needs
 * `ticket.message.moderate`. The two "no codes at all" rows below and the
 * `redact` gate are the properties this file exists to prove.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('messages', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'dddddddd-4444-4444-8444-dddddddddddd';
  const USER = 'dddddddd-5555-4555-8555-dddddddddddd';
  const TICKET = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';

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

  const wireMessage = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    ticketId: TICKET,
    content: 'Hello, I need a refund.',
    isAiGenerated: false,
    isInternalNote: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    attachments: [],
    excludedFromAiContext: false,
    answerStatus: 'MESSAGE_ANSWER_STATUS_UNSPECIFIED',
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

  rowFor('Messages')(
    '**`list` needs no permission at all — a caller with zero codes is still served**',
    async () => {
      peers.ticket.on('MessageService/ListMessages').reply({
        items: [wireMessage('m1')],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/messages`,
        headers([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { items: [{ id: 'm1' }] } });
    },
  );

  /**
   * `editableUntil` is ticket-service's answer for this caller; the gateway
   * relays it, and an absent one (the caller can't edit) is `null`.
   */
  rowFor('Messages')(
    '**`list` relays `editableUntil`, and an absent one is `null`**',
    async () => {
      peers.ticket.on('MessageService/ListMessages').reply({
        items: [
          wireMessage('mine', {
            editableUntil: { seconds: 1_756_685_700, nanos: 0 },
          }),
          wireMessage('theirs'),
        ],
        meta: {
          totalItems: 2,
          itemCount: 2,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/tickets/${TICKET}/messages`,
        headers([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            { id: 'mine', editableUntil: '2025-09-01T00:15:00.000Z' },
            { id: 'theirs', editableUntil: null },
          ],
        },
      });
    },
  );

  rowFor('Messages')(
    '**`create` needs no permission, forwards `isInternalNote`/`generatedFromId`/attachments, and answers 201**',
    async () => {
      peers.ticket.on('MessageService/CreateMessage').reply({
        message: wireMessage('m2', { isInternalNote: true }),
        skippedAttachments: ['bad-upload.png'],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/messages`,
        {
          content: 'Internal note',
          isInternalNote: true,
          generatedFromId: '11111111-1111-4111-8111-111111111111',
          attachments: [
            { objectPath: 'pending/abc', fileName: 'screenshot.png' },
          ],
        },
        headers([]),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        message: 'Message posted',
        data: {
          message: { isInternalNote: true },
          skippedAttachments: ['bad-upload.png'],
        },
      });
      const [call] = peers.ticket.calls('MessageService/CreateMessage');
      expect(call.request).toMatchObject({
        isInternalNote: true,
        generatedFromId: '11111111-1111-4111-8111-111111111111',
        attachments: [
          { objectPath: 'pending/abc', fileName: 'screenshot.png' },
        ],
      });
    },
  );

  rowFor('Messages')('**`update` needs no permission**', async () => {
    const id = '22222222-1111-4111-8111-222222222222';
    peers.ticket
      .on('MessageService/UpdateMessage')
      .reply(wireMessage(id, { content: 'Edited text' }));

    const response = await new Session(gateway.baseUrl).request(
      'PATCH',
      `${API}/tickets/${TICKET}/messages/${id}`,
      {
        body: { content: 'Edited text' },
        headers: headers([]),
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { content: 'Edited text' } });
  });

  rowFor('Messages')(
    '**`redact` is the one gated route: refused without `ticket.message.moderate`, never reaches the peer**',
    async () => {
      const id = '33333333-1111-4111-8111-333333333333';

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/tickets/${TICKET}/messages/${id}`,
        {
          headers: headers([]),
        },
      );

      expect(response.status).toBe(403);
      expect(peers.ticket.calls('MessageService/RedactMessage')).toHaveLength(
        0,
      );
    },
  );

  rowFor('Messages')(
    '**`redact` succeeds with `ticket.message.moderate` and returns 200, not 204**',
    async () => {
      const id = '44444444-1111-4111-8111-444444444444';
      peers.ticket.on('MessageService/RedactMessage').reply({
        message: wireMessage(id, {
          content: '[redacted]',
          redactedAt: { seconds: 1_756_684_800, nanos: 0 },
        }),
      });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/tickets/${TICKET}/messages/${id}`,
        {
          headers: headers(['ticket.message.moderate']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Message redacted',
        data: { content: '[redacted]' },
      });
    },
  );

  rowFor('Messages')(
    '**`presignNewAttachment` needs no permission and sends no `messageId`**',
    async () => {
      peers.ticket.on('MessageService/UploadAttachment').reply({
        uploadUrl: 'https://storage.test/upload',
        uploadMethod: 'PUT',
        objectPath: 'pending/xyz',
        expiresAt: { seconds: 1_756_685_400, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/messages/attachments/upload-url`,
        {
          fileName: 'screenshot.png',
          mimeType: 'image/png',
          fileSizeBytes: 1024,
        },
        headers([]),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          uploadUrl: 'https://storage.test/upload',
          uploadMethod: 'PUT',
          objectPath: 'pending/xyz',
        },
      });
      const [call] = peers.ticket.calls('MessageService/UploadAttachment');
      expect(call.request).not.toHaveProperty('messageId');
    },
  );

  rowFor('Messages')(
    '**`presignAttachment` needs no permission and sends the `messageId`**',
    async () => {
      const id = '55555555-1111-4111-8111-555555555555';
      peers.ticket.on('MessageService/UploadAttachment').reply({
        uploadUrl: 'https://storage.test/upload2',
        uploadMethod: 'PUT',
        objectPath: 'pending/abc',
        expiresAt: { seconds: 1_756_685_400, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/messages/${id}/attachments/upload-url`,
        { fileName: 'log.txt', mimeType: 'text/plain', fileSizeBytes: 512 },
        headers([]),
      );

      expect(response.status).toBe(200);
      const [call] = peers.ticket.calls('MessageService/UploadAttachment');
      expect(call.request).toMatchObject({ messageId: id });
    },
  );

  rowFor('Messages')(
    '**`confirmAttachment` needs no permission and answers 201**',
    async () => {
      const id = '66666666-1111-4111-8111-666666666666';
      peers.ticket.on('MessageService/ConfirmAttachment').reply({
        id: 'att-1',
        messageId: id,
        fileName: 'screenshot.png',
        fileUrl: 'https://storage.test/screenshot.png',
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/tickets/${TICKET}/messages/${id}/attachments/confirm`,
        { objectPath: 'pending/xyz', fileName: 'screenshot.png' },
        headers([]),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        message: 'Attachment added',
        data: { id: 'att-1' },
      });
    },
  );

  rowFor('Messages')('**`listAttachments` needs no permission**', async () => {
    const id = '77777777-1111-4111-8111-777777777777';
    peers.ticket.on('MessageService/ListAttachments').reply({
      items: [
        {
          id: 'att-2',
          messageId: id,
          fileName: 'notes.txt',
          fileUrl: 'https://storage.test/notes.txt',
          fileSizeBytes: 200,
          mimeType: 'text/plain',
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
        },
      ],
    });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/tickets/${TICKET}/messages/${id}/attachments`,
      headers([]),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ id: 'att-2', fileName: 'notes.txt' }],
    });
  });
});

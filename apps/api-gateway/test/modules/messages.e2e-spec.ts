import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  MAX_ATTACHMENT_BYTES,
  REDACTED_MESSAGE_PLACEHOLDER,
} from '@synapsedesk/common';
import {
  bootstrapE2eTest,
  E2eFixture,
  flushTestRedis,
} from '../utils/bootstrap';
import { anonymousAgent, API, authenticatedAgent } from '../utils/auth';
import {
  grpcError,
  timestamp,
  wireAttachment,
  wireMessage,
  wirePage,
} from '../fixtures/wire';

/**
 * §2.5 The ticket thread at the HTTP boundary.
 *
 * ticket-service is stubbed. The internal-note SQL filter, the edit window and
 * the redaction semantics all have their own suite against a real database —
 * what is under test here is the boundary: which routes are OPEN (almost all of
 * them, deliberately), the attachment DTO's two-layer validation, and the 503
 * that a client has to be able to tell apart from a crash.
 */
describe('§2.5 Ticket messages at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const ticketId = faker.string.uuid();
  const messageId = faker.string.uuid();
  const attachmentId = faker.string.uuid();

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  const upload = {
    fileName: 'screenshot.png',
    mimeType: 'image/png',
    fileSizeBytes: 2048,
  };

  describe('GET /tickets/:ticketId/messages', () => {
    it('1. is readable by an end user with NO permissions', async () => {
      // The thread is how a customer talks to support. Gating it would make the
      // product's core interaction staff-only.
      fx.stubs.message.listMessages.mockReturnValue(
        of({ items: [wireMessage()], meta: wirePage([]).meta }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/messages`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('2. renders an AI message with a null sender, never a missing key', async () => {
      fx.stubs.message.listMessages.mockReturnValue(
        of({
          items: [
            wireMessage({
              senderId: undefined,
              isAiGenerated: true,
              modelName: 'stub-model',
              promptTokens: 120,
              completionTokens: 80,
            }),
          ],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/messages`,
      );

      expect(res.body.data.items[0]).toHaveProperty('senderId', null);
      expect(res.body.data.items[0].modelName).toBe('stub-model');
      expect(res.body.data.items[0].promptTokens).toBe(120);
    });

    it('3. keeps a ZERO token count rather than nulling it', async () => {
      // `?? null` and not `|| null`: zero is a real reading, and erasing it into
      // "we did not measure" would quietly corrupt any cost report built on it.
      fx.stubs.message.listMessages.mockReturnValue(
        of({
          items: [wireMessage({ promptTokens: 0, completionTokens: 0 })],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/messages`,
      );

      expect(res.body.data.items[0].promptTokens).toBe(0);
    });

    it('4. surfaces the redaction flag ALONGSIDE the placeholder', async () => {
      // A client that had to infer redaction by string-matching the content
      // would render a user who literally typed "[message removed]" as redacted.
      fx.stubs.message.listMessages.mockReturnValue(
        of({
          items: [
            wireMessage({
              content: REDACTED_MESSAGE_PLACEHOLDER,
              redactedAt: timestamp(),
            }),
          ],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/messages`,
      );

      expect(res.body.data.items[0].redactedAt).not.toBeNull();
      expect(res.body.data.items[0].content).toBe(REDACTED_MESSAGE_PLACEHOLDER);
    });

    it('5. maps attachments, keeping fileUrl as the opaque object path', async () => {
      fx.stubs.message.listMessages.mockReturnValue(
        of({
          items: [wireMessage({ attachments: [wireAttachment()] })],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/${ticketId}/messages`,
      );

      expect(res.body.data.items[0].attachments[0].fileName).toBe(
        'screenshot.png',
      );
      expect(res.body.data.items[0].attachments[0].fileSizeBytes).toBe(2048);
    });

    it('6. rejects a NON-UUID ticket id', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/tickets/not-a-uuid/messages`,
      );

      expect(res.status).toBe(400);
    });

    it('7. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app).get(
        `${API}/tickets/${ticketId}/messages`,
      );

      expect(res.status).toBe(401);
    });
  });

  describe('POST /tickets/:ticketId/messages', () => {
    it('1. is postable by an end user with NO permissions', async () => {
      fx.stubs.message.createMessage.mockReturnValue(of(wireMessage()));

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: 'Still broken' });

      expect(res.status).toBe(201);
    });

    it('2. forwards isInternalNote WITHOUT gating the route on a permission', async () => {
      // A route-level gate would close the endpoint to end users, who post
      // ordinary replies through it. One FIELD is refused downstream instead of
      // the whole conversation.
      fx.stubs.message.createMessage.mockReturnValue(of(wireMessage()));

      await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: 'note', isInternalNote: true });

      const [request] = fx.stubs.message.createMessage.mock.calls[0];
      expect(request.isInternalNote).toBe(true);
    });

    it('3. sends the flags as FALSE when absent, never undefined', async () => {
      // proto3 booleans have no null. An absent flag means "an ordinary reply".
      fx.stubs.message.createMessage.mockReturnValue(of(wireMessage()));

      await authenticatedAgent(fx.app)
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: 'Plain reply' });

      const [request] = fx.stubs.message.createMessage.mock.calls[0];
      expect(request.isInternalNote).toBe(false);
      expect(request.invokeAi).toBe(false);
    });

    it('4. rejects empty content before any call', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: '' });

      expect(res.status).toBe(400);
      expect(fx.stubs.message.createMessage).not.toHaveBeenCalled();
    });

    it('5. rejects an UNKNOWN field rather than ignoring it', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: 'hi', senderId: faker.string.uuid() });

      expect(res.status).toBe(400);
    });

    it('6. returns the user message even with invokeAi — the AI reply is separate', async () => {
      // The response is the caller's own message. The generated reply is a
      // second row that arrives over the realtime channel, and a client waiting
      // for it in this response body would wait forever.
      fx.stubs.message.createMessage.mockReturnValue(
        of(wireMessage({ content: 'Please help', isAiGenerated: false })),
      );

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/tickets/${ticketId}/messages`)
        .send({ content: 'Please help', invokeAi: true });

      expect(res.status).toBe(201);
      expect(res.body.data.isAiGenerated).toBe(false);
      expect(res.body.data.content).toBe('Please help');
    });
  });

  describe('PATCH /tickets/:ticketId/messages/:messageId', () => {
    it('1. edits with no route permission — authorship is checked downstream', async () => {
      fx.stubs.message.updateMessage.mockReturnValue(
        of(wireMessage({ content: 'Corrected', editedAt: timestamp() })),
      );

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .patch(`${API}/tickets/${ticketId}/messages/${messageId}`)
        .send({ content: 'Corrected' });

      expect(res.status).toBe(200);
      expect(res.body.data.editedAt).not.toBeNull();
    });

    it('2. maps an expired edit window to 400', async () => {
      fx.stubs.message.updateMessage.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'A message can only be edited within 15 minutes of posting',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/tickets/${ticketId}/messages/${messageId}`)
        .send({ content: 'Too late' });

      expect(res.status).toBe(400);
    });

    it('3. maps a non-sender edit to 403', async () => {
      fx.stubs.message.updateMessage.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.PERMISSION_DENIED,
            'Only the sender may edit a message',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/tickets/${ticketId}/messages/${messageId}`)
        .send({ content: 'Not mine' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /tickets/:ticketId/messages/:messageId', () => {
    it('1. requires ticket.message.moderate', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).delete(`${API}/tickets/${ticketId}/messages/${messageId}`);

      expect(res.status).toBe(403);
      expect(fx.stubs.message.redactMessage).not.toHaveBeenCalled();
    });

    it('2. answers 200 WITH the message, not 204', async () => {
      // Redaction keeps the row. A 204 would tell the client the message was
      // gone, and a thread that silently loses a turn stops making sense at the
      // reply after it.
      fx.stubs.message.redactMessage.mockReturnValue(
        of({
          message: wireMessage({
            content: REDACTED_MESSAGE_PLACEHOLDER,
            redactedAt: timestamp(),
          }),
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.message.moderate'],
      }).delete(`${API}/tickets/${ticketId}/messages/${messageId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe(REDACTED_MESSAGE_PLACEHOLDER);
      expect(res.body.data.redactedAt).not.toBeNull();
    });

    it('3. maps a double redaction to 400', async () => {
      fx.stubs.message.redactMessage.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'That message is already redacted',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.message.moderate'],
      }).delete(`${API}/tickets/${ticketId}/messages/${messageId}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /tickets/:ticketId/messages/:messageId/attachments/upload-url', () => {
    const presigned = () =>
      of({
        uploadUrl: 'https://storage.example/signed-put',
        objectPath: 'organizations/o/tickets/t/attachments/m/abc.png',
        expiresAt: timestamp(),
      });

    it('1. answers 200 with a URL — nothing is CREATED yet', async () => {
      // A 201 would tell a client the attachment existed when all it has is
      // permission to make one.
      fx.stubs.message.uploadAttachment.mockReturnValue(presigned());

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send(upload);

      expect(res.status).toBe(200);
      expect(res.body.data.uploadUrl).toBe(
        'https://storage.example/signed-put',
      );
      expect(res.body.data.objectPath).toBeTruthy();
    });

    it('2. rejects a DISALLOWED mime type before any network call', async () => {
      // An allowlist, never a denylist: a denylist is a promise to have thought
      // of every dangerous type, and nobody can keep that promise.
      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send({ ...upload, mimeType: 'application/x-httpd-php' });

      expect(res.status).toBe(400);
      expect(fx.stubs.message.uploadAttachment).not.toHaveBeenCalled();
    });

    it('3. rejects an OVERSIZED file before any network call', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send({ ...upload, fileSizeBytes: MAX_ATTACHMENT_BYTES + 1 });

      expect(res.status).toBe(400);
      expect(fx.stubs.message.uploadAttachment).not.toHaveBeenCalled();
    });

    it('4. accepts a file EXACTLY at the cap', async () => {
      // Off-by-one at a boundary is the classic way a cap rejects a legal file,
      // and nobody notices until a user with a 10 MB PDF complains.
      fx.stubs.message.uploadAttachment.mockReturnValue(presigned());

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send({ ...upload, fileSizeBytes: MAX_ATTACHMENT_BYTES });

      expect(res.status).toBe(200);
    });

    it('5. rejects a zero-byte file', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send({ ...upload, fileSizeBytes: 0 });

      expect(res.status).toBe(400);
    });

    it('6. maps the per-message CAP to 400', async () => {
      // Enforced in ticket-service before storage-service is called at all, so
      // a caller already at the cap never receives a usable URL.
      fx.stubs.message.uploadAttachment.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'A message can carry at most 5 attachments',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send(upload);

      expect(res.status).toBe(400);
    });

    it('7. maps a storage outage to 503, not 500', async () => {
      // A client can retry a 503. A 500 would send somebody debugging our code
      // for somebody else's outage.
      fx.stubs.message.uploadAttachment.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAVAILABLE, 'File storage is unavailable'),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/upload-url`,
        )
        .send(upload);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /tickets/:ticketId/messages/:messageId/attachments/confirm', () => {
    it('1. writes the attachment and returns it', async () => {
      fx.stubs.message.confirmAttachment.mockReturnValue(of(wireAttachment()));

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/confirm`,
        )
        .send({
          objectPath: 'organizations/o/t/a/x.png',
          fileName: 'shot.png',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toBe('screenshot.png');
    });

    it('2. maps an unauthorized path to 404', async () => {
      // storage-service answers NOT_FOUND for a path it never authorized —
      // expired, never presigned, already confirmed, or another tenant's.
      // Telling those apart would be the leak.
      fx.stubs.message.confirmAttachment.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No pending upload for that path'),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/confirm`,
        )
        .send({
          objectPath: 'organizations/o/t/a/x.png',
          fileName: 'shot.png',
        });

      expect(res.status).toBe(404);
    });

    it('3. REQUIRES an objectPath', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(
          `${API}/tickets/${ticketId}/messages/${messageId}/attachments/confirm`,
        )
        .send({ fileName: 'shot.png' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /tickets/:ticketId/messages/:messageId/attachments', () => {
    it('1. lists with no permission — same visibility as the thread', async () => {
      fx.stubs.message.listAttachments.mockReturnValue(
        of({ items: [wireAttachment()] }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/tickets/${ticketId}/messages/${messageId}/attachments`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('DELETE /attachments/:id', () => {
    it('1. requires ticket.message.moderate', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).delete(`${API}/attachments/${attachmentId}`);

      expect(res.status).toBe(403);
      expect(fx.stubs.message.deleteAttachment).not.toHaveBeenCalled();
    });

    it('2. answers 204 for a moderator', async () => {
      fx.stubs.message.deleteAttachment.mockReturnValue(of({}));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.message.moderate'],
      }).delete(`${API}/attachments/${attachmentId}`);

      expect(res.status).toBe(204);
    });

    it('3. maps a cross-tenant attempt to 404', async () => {
      fx.stubs.message.deleteAttachment.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No attachment with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.message.moderate'],
      }).delete(`${API}/attachments/${attachmentId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /attachments/:id/download', () => {
    it('1. maps a storage outage to 503, not 500', async () => {
      fx.stubs.message.downloadAttachment.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.UNAVAILABLE, 'File storage is unavailable'),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/attachments/${attachmentId}/download`,
      );

      expect(res.status).toBe(503);
    });

    it('2. maps a cross-tenant attempt to 404, not 403', async () => {
      // 403 would confirm the attachment exists, turning id enumeration into a
      // tenant-membership oracle.
      fx.stubs.message.downloadAttachment.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No attachment with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/attachments/${attachmentId}/download`,
      );

      expect(res.status).toBe(404);
    });

    it('3. returns the url and its expiry once storage answers', async () => {
      fx.stubs.message.downloadAttachment.mockReturnValue(
        of({
          downloadUrl: 'https://storage.example/signed',
          expiresAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/attachments/${attachmentId}/download`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBe('https://storage.example/signed');
      expect(res.body.data.expiresAt).toBeDefined();
    });

    it('4. rejects a NON-UUID attachment id', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/attachments/not-a-uuid/download`,
      );

      expect(res.status).toBe(400);
    });

    it('5. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app).get(
        `${API}/attachments/${attachmentId}/download`,
      );

      expect(res.status).toBe(401);
    });
  });
});

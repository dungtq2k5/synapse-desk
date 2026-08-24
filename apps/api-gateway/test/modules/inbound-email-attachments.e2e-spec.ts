import request from 'supertest';
import { of, throwError } from 'rxjs';
import { InboundOutcome } from '../../src/modules/inbound-email/inbound-email.service';
import { faker } from '@faker-js/faker';
import { ConfigService } from '@nestjs/config';
import {
  buildInboundAddress,
  buildTicketReplyToken,
  generateInboundToken,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@synapsedesk/common';
import { OrgStatus as ProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { timestamp, wireCreatedMessage } from '../fixtures/wire';
import {
  plainEmail,
  signPayload,
  INBOUND_DOMAIN,
} from '../fixtures/inbound-email';

/**
 * Attachments on an inbound REPLY, the reply half of the
 * co-pilot plan.
 *
 * **The bytes never reach this server.** The Worker presigns here, PUTs to
 * storage directly, and the webhook carries only object paths — so the one
 * route that takes input from an unauthenticated sender never takes their file
 * bytes. These tests assert the two halves of that contract: what the presign
 * route agrees to, and that the paths reach `createMessage`.
 *
 * **The new-ticket half is deliberately absent and asserted absent.** A mail
 * that opens a ticket has no message to attach to, because `createTicket`
 * writes a ticket row and nothing else.
 */
describe('Inbound email attachments — the reply half (e2e)', () => {
  let fx: E2eFixture;
  let secret: string;

  const organizationId = faker.string.uuid();
  const senderId = faker.string.uuid();
  const ticketId = faker.string.uuid();
  const tenantToken = generateInboundToken();

  const signedPost = (path: string, payload: Record<string, unknown>) => {
    const { body, signature } = signPayload(payload, secret);

    return request(fx.app.getHttpServer())
      .post(path)
      .set('content-type', 'application/json')
      .set('x-inbound-signature', signature)
      .send(body);
  };

  const presign = (payload: Record<string, unknown>) =>
    signedPost('/api/v1/webhooks/email/attachments', payload);

  const webhook = (payload: Record<string, unknown>) =>
    signedPost('/api/v1/webhooks/email/inbound', payload);

  const resolvable = () => {
    fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
      of({ organizationId, status: ProtoOrgStatus.ORG_STATUS_ACTIVE }),
    );
    fx.stubs.user.resolveInboundSender.mockReturnValue(
      of({ userId: senderId, created: false }),
    );
  };

  const wireTicket = () => ({
    id: ticketId,
    ticketNumber: 4211,
    organizationId,
    authorId: senderId,
    source: 3,
    status: 2,
    priority: 2,
    title: 'The printer is on fire',
    description: 'It really is',
    currentDepartmentId: faker.string.uuid(),
    unreadCount: 0,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  });

  /** The address a reply carries: tenant token plus a ticket reply token. */
  const replyTo = () =>
    buildInboundAddress(
      INBOUND_DOMAIN,
      tenantToken,
      buildTicketReplyToken(organizationId, 4211, secret),
    );

  const routing = (overrides: Record<string, unknown> = {}) => ({
    to: replyTo(),
    from: 'customer@example.test',
    ...overrides,
  });

  const file = (overrides: Record<string, unknown> = {}) => ({
    fileName: 'error.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    ...overrides,
  });

  const wirePresigned = (objectPath: string) => ({
    uploadUrl: `https://storage.test/put?path=${objectPath}`,
    objectPath,
    expiresAt: timestamp(),
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    secret = fx.app
      .get(ConfigService)
      .getOrThrow<string>('INBOUND_EMAIL_SECRET');
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => fx.close());

  describe('the presign route', () => {
    it('**presigns against the ticket the reply threads onto**', async () => {
      // The whole reason the route exists: the Worker cannot resolve a ticket
      // — the reply token's MAC and the tenant lookup live here — so it asks.
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.uploadAttachment.mockReturnValue(
        of(
          wirePresigned('organizations/o/tickets/t/attachments/pending/a.png'),
        ),
      );

      const response = await presign(routing({ files: [file()] })).expect(200);

      expect(response.body.data.uploads).toEqual([
        {
          fileName: 'error.png',
          uploadUrl: expect.stringContaining('https://storage.test/put'),
          objectPath: 'organizations/o/tickets/t/attachments/pending/a.png',
        },
      ]);
      expect(response.body.data.declined).toEqual([]);

      // Against the RESOLVED ticket, and with no message — the message does not
      // exist until the webhook that follows.
      const [[sent]] = fx.stubs.message.uploadAttachment.mock.calls;
      expect(sent).toMatchObject({ ticketId, messageId: undefined });
    });

    it('**declines everything for a mail that would OPEN a ticket**', async () => {
      // The new-ticket half, asserted as absent rather than left to be
      // discovered: `createTicket` writes a ticket row and no message, so there
      // is no `message_attachments` parent for a path to hang under.
      resolvable();

      const response = await presign({
        to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
        from: 'customer@example.test',
        files: [file()],
      }).expect(200);

      expect(response.body.data.uploads).toEqual([]);
      expect(response.body.data.declined).toEqual([
        { fileName: 'error.png', reason: 'no ticket to attach to' },
      ]);
      expect(fx.stubs.message.uploadAttachment).not.toHaveBeenCalled();
    });

    it('declines an unroutable mail without asking storage anything', async () => {
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({ organizationId: '', status: ProtoOrgStatus.ORG_STATUS_ACTIVE }),
      );

      const response = await presign(routing({ files: [file()] })).expect(200);

      expect(response.body.data.declined).toEqual([
        { fileName: 'error.png', reason: 'unroutable' },
      ]);
      expect(fx.stubs.message.uploadAttachment).not.toHaveBeenCalled();
    });

    it('**declines past the per-message ceiling, by name**', async () => {
      // `createMessage` THROWS when the list is over the cap rather than
      // trimming it — so a mail with eight attachments would lose the message,
      // not the extra files. Declining here keeps it a partial loss with a name
      // on it.
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.uploadAttachment.mockImplementation(() =>
        of(wirePresigned(`organizations/o/t/a/pending/${faker.string.uuid()}`)),
      );

      const files = Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE + 2 },
        (_, i) => file({ fileName: `file-${i}.png` }),
      );

      const response = await presign(routing({ files })).expect(200);

      expect(response.body.data.uploads).toHaveLength(
        MAX_ATTACHMENTS_PER_MESSAGE,
      );
      expect(
        response.body.data.declined.map(
          (d: { fileName: string }) => d.fileName,
        ),
      ).toEqual([
        `file-${MAX_ATTACHMENTS_PER_MESSAGE}.png`,
        `file-${MAX_ATTACHMENTS_PER_MESSAGE + 1}.png`,
      ]);
    });

    it('declines an oversized file without presigning it', async () => {
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));

      const response = await presign(
        routing({ files: [file({ sizeBytes: MAX_ATTACHMENT_BYTES + 1 })] }),
      ).expect(200);

      expect(response.body.data.declined).toEqual([
        { fileName: 'error.png', reason: 'too large' },
      ]);
      expect(fx.stubs.message.uploadAttachment).not.toHaveBeenCalled();
    });

    it('**refuses a MIME type outside the upload allowlist** at the DTO', async () => {
      // The allowlist lives here, not in the Worker — a second copy in a
      // Cloudflare Worker is a copy that drifts from the one storage-service
      // enforces. A 400 rather than a decline: the Worker sent something the
      // contract does not permit, which is a bug in the Worker.
      //
      // **`application/x-msdownload`, not `application/zip`.** A zip is
      // perfectly storable — it is on the UPLOAD allowlist and only the
      // AI-eligible list excludes it. Picking it here would have
      // tested the wrong list, which is exactly what the first draft did.
      resolvable();

      await presign(
        routing({ files: [file({ mimeType: 'application/x-msdownload' })] }),
      ).expect(400);
    });

    it('one refused file does not fail the batch', async () => {
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.uploadAttachment
        .mockReturnValueOnce(throwError(() => new Error('storage said no')))
        .mockReturnValueOnce(
          of(wirePresigned('organizations/o/t/a/pending/good.png')),
        );

      const response = await presign(
        routing({
          files: [
            file({ fileName: 'bad.png' }),
            file({ fileName: 'good.png' }),
          ],
        }),
      ).expect(200);

      expect(
        response.body.data.uploads.map((u: { fileName: string }) => u.fileName),
      ).toEqual(['good.png']);
      expect(response.body.data.declined).toEqual([
        { fileName: 'bad.png', reason: 'refused by storage' },
      ]);
    });

    it('**needs the signature, like the webhook it precedes**', async () => {
      await request(fx.app.getHttpServer())
        .post('/api/v1/webhooks/email/attachments')
        .set('content-type', 'application/json')
        .send({ ...routing(), files: [file()] })
        .expect(401);
    });
  });

  describe('the webhook that follows', () => {
    it('**carries the object paths into `createMessage`**', async () => {
      // The reply half, end to end. Before this, the same call passed
      // `attachments: []` under a comment saying no inbound email ever uploads
      // before its message exists — which is now exactly what one does.
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      const response = await webhook(
        plainEmail({
          to: replyTo(),
          attachments: [
            {
              objectPath: 'organizations/o/tickets/t/attachments/pending/a.png',
              fileName: 'error.png',
            },
          ],
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.APPENDED);

      const [[sent]] = fx.stubs.message.createMessage.mock.calls;
      expect(sent).toMatchObject({
        attachments: [
          {
            objectPath: 'organizations/o/tickets/t/attachments/pending/a.png',
            fileName: 'error.png',
          },
        ],
      });
    });

    it('a reply with no attachments still sends an empty list', async () => {
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await webhook(plainEmail({ to: replyTo() })).expect(200);

      const [[sent]] = fx.stubs.message.createMessage.mock.calls;
      expect(sent).toMatchObject({ attachments: [] });
    });

    it('**a REPLY now says what was dropped, which it never did before**', async () => {
      // `withAttachmentNote` was only ever reached on ticket creation, so an
      // emailed reply carrying attachments dropped them in silence — no file,
      // no note, nothing in the thread. Survivable while mail dropped every
      // attachment; not survivable now that some land and some do not.
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await webhook(
        plainEmail({ to: replyTo(), droppedAttachments: ['huge.zip'] }),
      ).expect(200);

      const [[sent]] = fx.stubs.message.createMessage.mock.calls;
      expect((sent as { content: string }).content).toContain('huge.zip');
    });

    it('refuses more attachments than a message may carry', async () => {
      // The DTO's own bound. The presign route will not hand out more than the
      // cap, so a payload over it did not come from a Worker following the
      // contract.
      resolvable();

      await webhook(
        plainEmail({
          to: replyTo(),
          attachments: Array.from(
            { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
            (_, i) => ({
              objectPath: `organizations/o/t/a/pending/${i}.png`,
              fileName: `file-${i}.png`,
            }),
          ),
        }),
      ).expect(400);
    });
  });
});

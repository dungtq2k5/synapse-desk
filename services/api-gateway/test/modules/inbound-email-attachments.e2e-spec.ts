import request from 'supertest';
import { Subject, of, throwError } from 'rxjs';
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
import { InboundOutcome } from '../../src/modules/inbound-email/inbound-email.service';
import {
  RESEND_INBOUND_CLIENT,
  type ResendInboundClient,
} from '../../src/modules/inbound-email/resend-inbound.client';
import {
  API,
  E2eFixture,
  bootstrapE2eTest,
  signStandardWebhook,
} from '../utils';
import { timestamp, wireCreatedMessage } from '../fixtures/wire';
import {
  INBOUND_DOMAIN,
  plainEmail,
  resendDelivery,
  type FixtureFile,
} from '../fixtures/inbound-email';

/**
 * Attachments on an inbound mail, through the Resend webhook.
 *
 * **The bytes never reach this server.** The gateway lists the attachments'
 * signed URLs after routing, hands each URL to ticket-service's
 * `IngestAttachment` — which has storage-service fetch it — and passes the
 * object paths it gets back to `createMessage`. These tests pin what the
 * gateway decides: which files are ingested, against which ticket, under which
 * tenant limits, and that every file it does not store is NAMED in the ticket.
 *
 * **The new-ticket half is deliberately absent and asserted absent.** A mail
 * that opens a ticket has no message to attach to, because `createTicket`
 * writes a ticket row and nothing else.
 */
describe('Inbound email attachments (e2e)', () => {
  let fx: E2eFixture;
  let replySecret: string;
  let webhookSecret: string;
  let receivingGet: jest.SpyInstance;
  let attachmentsList: jest.SpyInstance;

  const organizationId = faker.string.uuid();
  const senderId = faker.string.uuid();
  const ticketId = faker.string.uuid();
  const tenantToken = generateInboundToken();

  /** Delivers a mail through the real webhook, with Resend's two reads faked. */
  const deliver = (
    payload: Record<string, unknown>,
    tweakList?: (
      list: ReturnType<typeof resendDelivery>['attachmentList'],
    ) => void,
  ) => {
    const { event, email, attachmentList } = resendDelivery(payload);
    tweakList?.(attachmentList);
    receivingGet.mockResolvedValue({ data: email, error: null, headers: null });
    attachmentsList.mockResolvedValue({
      data: attachmentList,
      error: null,
      headers: null,
    });
    const body = JSON.stringify(event);

    return request(fx.app.getHttpServer())
      .post(`${API}/webhooks/email/resend`)
      .set('content-type', 'application/json')
      .set(signStandardWebhook(body, webhookSecret))
      .send(body);
  };

  const resolvable = (organization: Record<string, unknown> = {}) => {
    fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
      of({
        organizationId,
        status: ProtoOrgStatus.ORG_STATUS_ACTIVE,
        maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
        ...organization,
      }),
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

  /** A reply: the tenant token plus a ticket reply token. */
  const replyTo = () =>
    buildInboundAddress(
      INBOUND_DOMAIN,
      tenantToken,
      buildTicketReplyToken(organizationId, 4211, replySecret),
    );

  /** A reply carrying `files`, threading onto the ticket the stubs resolve. */
  const reply = (files: FixtureFile[], overrides = {}) =>
    plainEmail({ to: replyTo(), files, ...overrides });

  const png = (overrides: Partial<FixtureFile> = {}): FixtureFile => ({
    filename: 'error.png',
    contentType: 'image/png',
    size: 2048,
    ...overrides,
  });

  const threaded = () => {
    resolvable();
    fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
    fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));
    fx.stubs.message.ingestAttachment.mockImplementation((req) =>
      of({
        objectPath: `organizations/${organizationId}/tickets/${ticketId}/attachments/pending/${req.fileName}`,
      }),
    );
  };

  const createdMessage = () =>
    fx.stubs.message.createMessage.mock.calls[0][0] as {
      content: string;
      attachments: { objectPath: string; fileName: string }[];
    };

  const ingestedNames = () =>
    fx.stubs.message.ingestAttachment.mock.calls.map(([req]) => req.fileName);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    const config = fx.app.get(ConfigService);
    replySecret = config.getOrThrow<string>('INBOUND_EMAIL_SECRET');
    webhookSecret = config.getOrThrow<string>('RESEND_WEBHOOK_SECRET');
    const client = fx.app.get<ResendInboundClient>(RESEND_INBOUND_CLIENT, {
      strict: false,
    });
    // The fetches are replaced; the signature verifier stays the SDK's own.
    receivingGet = jest.spyOn(client.emails.receiving, 'get');
    attachmentsList = jest.spyOn(client.emails.receiving.attachments, 'list');
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => fx.close());

  // ------------------------------------------------------------ what lands

  describe('a reply', () => {
    it('**ingests against the ticket the reply threads onto, and carries the paths into `createMessage`**', async () => {
      threaded();

      const response = await deliver(reply([png()])).expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.APPENDED);
      const [[sent]] = fx.stubs.message.ingestAttachment.mock.calls;
      expect(sent).toEqual({
        ticketId,
        fileName: 'error.png',
        fileSizeBytes: 2048,
        mimeType: 'image/png',
        sourceUrl: expect.stringMatching(
          /^https:\/\/attachments\.resend\.test\//,
        ),
      });
      expect(createdMessage().attachments).toEqual([
        {
          objectPath: `organizations/${organizationId}/tickets/${ticketId}/attachments/pending/error.png`,
          fileName: 'error.png',
        },
      ]);
    });

    it('a reply with no attachments still sends an empty list, and lists nothing', async () => {
      threaded();

      await deliver(plainEmail({ to: replyTo() })).expect(200);

      expect(createdMessage().attachments).toEqual([]);
      expect(attachmentsList).not.toHaveBeenCalled();
    });

    it('**a REPLY says what was dropped**', async () => {
      threaded();

      await deliver(
        reply([
          png(),
          png({ filename: 'huge.zip', contentType: 'application/zip' }),
        ]),
      ).expect(200);

      expect(createdMessage().content).toContain(
        'Attachments were not accepted by email: huge.zip',
      );
      expect(ingestedNames()).toEqual(['error.png']);
    });

    it('**a MIME type outside the allowlist is dropped at the mapper** — named, and the mail still delivered', async () => {
      // `application/x-msdownload`, not `application/zip`: a zip is not on the
      // upload allowlist either, but the executable is the case that matters.
      threaded();

      const response = await deliver(
        reply([
          png({
            filename: 'setup.exe',
            contentType: 'application/x-msdownload',
          }),
        ]),
      ).expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.APPENDED);
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('setup.exe');
    });

    it('one refused file does not fail the batch', async () => {
      threaded();
      fx.stubs.message.ingestAttachment
        .mockReturnValueOnce(throwError(() => new Error('storage said no')))
        .mockImplementation((req) => of({ objectPath: `p/${req.fileName}` }));

      await deliver(
        reply([png({ filename: 'bad.png' }), png({ filename: 'good.png' })]),
      ).expect(200);

      expect(createdMessage().attachments.map((file) => file.fileName)).toEqual(
        ['good.png'],
      );
      expect(createdMessage().content).toContain('bad.png');
    });
  });

  // ------------------------------------------------ what never reaches storage

  describe('what is declined without asking storage', () => {
    it('**declines everything for a mail that would OPEN a ticket**, and names the eligible files', async () => {
      // The new-ticket half, asserted absent: there is no message to attach to.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await deliver(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          files: [png()],
        }),
      ).expect(200);

      expect(attachmentsList).not.toHaveBeenCalled();
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      const [[created]] = fx.stubs.ticket.createTicket.mock.calls;
      expect(created.description).toContain(
        'Attachments were not accepted by email: error.png',
      );
    });

    it('an unroutable mail lists nothing and asks storage nothing', async () => {
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({ organizationId: undefined, status: 0, maxAttachmentBytes: 0 }),
      );

      const response = await deliver(reply([png()])).expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.UNROUTABLE);
      expect(attachmentsList).not.toHaveBeenCalled();
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
    });

    it('a refused sender lists nothing and asks storage nothing', async () => {
      resolvable();
      fx.stubs.user.resolveInboundSender.mockReturnValue(
        of({ userId: undefined, created: false }),
      );

      const response = await deliver(reply([png()])).expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.SENDER_REFUSED);
      expect(attachmentsList).not.toHaveBeenCalled();
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
    });

    it('**past the per-message ceiling, by name**', async () => {
      // `createMessage` THROWS over the cap rather than trimming — so a mail
      // with eight attachments would lose the message, not the extra files.
      threaded();
      const files = Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE + 2 },
        (_, i) => png({ filename: `file-${i}.png` }),
      );

      await deliver(reply(files)).expect(200);

      expect(ingestedNames()).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
      expect(createdMessage().content).toContain(
        `file-${MAX_ATTACHMENTS_PER_MESSAGE}.png, file-${MAX_ATTACHMENTS_PER_MESSAGE + 1}.png`,
      );
    });

    it('an oversized file is named without an ingest', async () => {
      threaded();

      await deliver(reply([png({ size: MAX_ATTACHMENT_BYTES + 1 })])).expect(
        200,
      );

      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('error.png');
    });

    it('**5. an EMAILED attachment obeys the tenant override**', async () => {
      // Reachable by anyone who can email the tenant's address, so a workspace
      // that narrowed its limit has not got the control it asked for if the
      // limit applies only to signed-in users. The override rides
      // `resolveOrgByInboundToken`, which this path already calls.
      threaded();
      resolvable({ maxAttachmentBytesOverride: 1_000_000 });

      await deliver(reply([png({ size: 2_000_000 })])).expect(200);

      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('error.png');
    });

    it('**5b. …and the same file is ingested when the tenant set no override**', async () => {
      // The pair: test 5 alone passes for a path that refuses every file.
      threaded();

      await deliver(reply([png({ size: 2_000_000 })])).expect(200);

      expect(ingestedNames()).toEqual(['error.png']);
    });

    it('**5d. an EMAILED attachment obeys the PLAN grant, with no override set**', async () => {
      threaded();
      resolvable({ maxAttachmentBytes: 1_000_000 });

      await deliver(reply([png({ size: 2_000_000 })])).expect(200);

      // 5b ingests this exact file at the platform ceiling, so the refusal can
      // only be the plan layer.
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
    });

    it('**5c. the per-message COUNT override is honoured on this path too**', async () => {
      threaded();
      resolvable({ maxAttachmentsPerMessageOverride: 1 });

      await deliver(
        reply([png({ filename: 'a.png' }), png({ filename: 'b.png' })]),
      ).expect(200);

      expect(ingestedNames()).toEqual(['a.png']);
      expect(createdMessage().content).toContain('b.png');
    });

    it('**an already-expired source is named without a call**', async () => {
      threaded();

      await deliver(
        reply([png({ expiresAt: new Date(Date.now() - 1_000).toISOString() })]),
      ).expect(200);

      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('error.png');
    });

    it('a source URL storage could not accept is named without a call', async () => {
      threaded();

      await deliver(
        reply([
          png({
            filename: 'plain.png',
            downloadUrl: 'http://attachments.resend.test/x',
          }),
          png({
            filename: 'long.png',
            downloadUrl: `https://attachments.resend.test/${'x'.repeat(2_100)}`,
          }),
        ]),
      ).expect(200);

      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('plain.png, long.png');
    });
  });

  // ------------------------------------------------------- the list call

  describe('`attachments.list`', () => {
    it('is asked for the whole list — `limit: 100`, not the default twenty', async () => {
      threaded();

      await deliver(reply([png()])).expect(200);

      expect(attachmentsList).toHaveBeenCalledWith({
        emailId: expect.any(String),
        limit: 100,
      });
    });

    it('**a `has_more` page → the files not on it are named**', async () => {
      threaded();

      await deliver(
        reply([
          png({ filename: 'first.png' }),
          png({ filename: 'second.png' }),
        ]),
        (list) => {
          list.data = list.data.slice(0, 1);
          list.has_more = true;
        },
      ).expect(200);

      expect(ingestedNames()).toEqual(['first.png']);
      expect(createdMessage().content).toContain('second.png');
    });

    it('**a 429 is 503, before anything is stored or written**', async () => {
      threaded();
      const pending = deliver(reply([png()]));
      attachmentsList.mockResolvedValue({
        data: null,
        error: {
          name: 'rate_limit_exceeded',
          statusCode: 429,
          message: 'slow down',
        },
        headers: null,
      });

      await pending.expect(503);

      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(fx.stubs.message.createMessage).not.toHaveBeenCalled();
    });

    it('**a 404 delivers the mail and names every file**', async () => {
      threaded();
      const pending = deliver(
        reply([png({ filename: 'a.png' }), png({ filename: 'b.png' })]),
      );
      attachmentsList.mockResolvedValue({
        data: null,
        error: { name: 'not_found', statusCode: 404, message: 'gone' },
        headers: null,
      });

      const response = await pending.expect(200);

      expect(response.body.data.outcome).toBe(InboundOutcome.APPENDED);
      expect(fx.stubs.message.ingestAttachment).not.toHaveBeenCalled();
      expect(createdMessage().content).toContain('a.png, b.png');
    });
  });

  // ------------------------------------------------------- concurrency

  it('**five files ingest two at a time, never more**', async () => {
    // Sequential fetches stack inside one webhook request, and a request that
    // outlasts Resend's timeout is redelivered — re-ingesting every file.
    threaded();
    const inFlight = new Set<string>();
    let peak = 0;

    fx.stubs.message.ingestAttachment.mockImplementation((req) => {
      const done = new Subject<{ objectPath: string }>();
      inFlight.add(req.fileName);
      peak = Math.max(peak, inFlight.size);
      // Settle on the next turn, after every file that could start has started.
      setTimeout(() => {
        inFlight.delete(req.fileName);
        done.next({ objectPath: `p/${req.fileName}` });
        done.complete();
      }, 20);
      return done.asObservable();
    });

    const files = Array.from({ length: 5 }, (_, i) =>
      png({ filename: `f-${i}.png` }),
    );
    await deliver(reply(files)).expect(200);

    expect(ingestedNames()).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(peak).toBe(2);
    expect(createdMessage().attachments).toHaveLength(5);
  });
});

import { faker } from '@faker-js/faker';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { expectRpc } from '@synapsedesk/testing/rpc';
import type { PermissionCode } from '@synapsedesk/contracts';
import {
  TicketPriority,
  TicketSource,
  type AttachmentPart,
} from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest, pageRequest } from '../utils';
import { buildTenant, createMessage, TenantFixture } from '../factories';
import { memberContext } from '../utils/context';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { AiService } from '../../src/modules/ai/ai.service';
import { AiAttachmentService } from '../../src/modules/ai-attachments/ai-attachment.service';
import { AttachmentExtractorClient } from '../../src/modules/ai-client/attachment-extractor.client';
import { RagClientService } from '../../src/modules/ai-client/rag-client.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';

/**
 * Files on a ticket's opening: uploaded before the ticket exists, bound by
 * `CreateTicket` with no message, and read by the first answer.
 *
 * storage-service is stubbed: its uploader and purpose checks belong to its
 * own suite. What is provable here is where the rows land, who may read them,
 * and which AI surface sends them.
 */
describe('Files on the opening (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let messages: MessagesService;
  let ai: AiService;
  let aiAttachments: AiAttachmentService;
  let storage: StorageReferenceService;
  let rag: RagClientService;
  let confirmUpload: jest.SpyInstance;
  let generateReplyDraft: jest.SpyInstance;
  let tenant: TenantFixture;

  const PNG = Buffer.from('PNG bytes');
  const requester = () =>
    memberContext({ id: tenant.userId, organizationId: tenant.organizationId });
  const agent = (permissions: PermissionCode[] = []) =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      ['ticket.read.all', ...permissions],
    );

  const uploaded = (fileName: string) => ({
    objectPath: `organizations/${tenant.organizationId}/ticket-openings/${tenant.userId}/pending/${faker.string.uuid()}.png`,
    fileName,
  });

  const open = (
    attachments: { objectPath: string; fileName: string }[],
    overrides: Record<string, unknown> = {},
  ) =>
    tickets.createTicket(
      {
        title: 'The app crashes',
        description: 'It crashes on this screen, see the screenshot.',
        priority: TicketPriority.TICKET_PRIORITY_UNSPECIFIED,
        source: TicketSource.TICKET_SOURCE_CHAT,
        attachments,
        ...overrides,
      },
      requester(),
    );

  const draft = {
    content: 'Try signing in again.',
    modelName: 'whatever-rag-service-resolved',
    promptTokens: 10,
    completionTokens: 5,
    generationId: 'gen-opening',
    citations: [],
  };

  /** The parts the n-th draft request carried (the fifth argument). */
  const partsSent = (call = 0) =>
    generateReplyDraft.mock.calls[call][4] as AttachmentPart[];

  /** Waits for the background first answer to have asked rag-service. */
  const draftRequested = async () => {
    for (let tries = 0; tries < 50; tries++) {
      if (generateReplyDraft.mock.calls.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The first answer never asked for a draft');
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    messages = fx.moduleRef.get(MessagesService);
    ai = fx.moduleRef.get(AiService);
    aiAttachments = fx.moduleRef.get(AiAttachmentService);
    storage = fx.moduleRef.get(StorageReferenceService);
    rag = fx.moduleRef.get(RagClientService);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();

    confirmUpload = jest
      .spyOn(storage, 'confirmUpload')
      .mockImplementation((objectPath: string) =>
        Promise.resolve({
          objectPath: objectPath.replace('/pending/', '/'),
          sizeBytes: PNG.length,
          contentType: 'image/png',
        }),
      );
    jest.spyOn(storage, 'downloadObject').mockResolvedValue(PNG);
    jest.spyOn(rag, 'isAvailable', 'get').mockReturnValue(true);
    generateReplyDraft = jest
      .spyOn(rag, 'generateReplyDraft')
      .mockResolvedValue(draft);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => fx.close());

  describe('CreateTicket with files', () => {
    it('**binds them to the ticket, not to a message**, with the confirmed path', async () => {
      const { ticket, skippedAttachments } = await open([
        uploaded('screen.png'),
      ]);

      expect(skippedAttachments).toEqual([]);
      expect(ticket?.attachments).toEqual([
        expect.objectContaining({
          fileName: 'screen.png',
          ticketId: ticket?.id,
          messageId: undefined,
          mimeType: 'image/png',
        }),
      ]);
      expect(ticket?.attachments[0].fileUrl).not.toContain('/pending/');

      const rows = await fx.prisma.messageAttachment.findMany({
        where: { ticketId: ticket?.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].messageId).toBeNull();
      expect(await fx.prisma.ticketMessage.count()).toBe(0);
    });

    it('**extracts a document’s text at create**, through the one hook', async () => {
      confirmUpload.mockResolvedValue({
        objectPath: `organizations/${tenant.organizationId}/ticket-openings/${tenant.userId}/notes.docx`,
        sizeBytes: 4096,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      jest
        .spyOn(fx.moduleRef.get(AttachmentExtractorClient), 'extract')
        .mockResolvedValue('# The steps I took');

      const { ticket } = await open([uploaded('notes.docx')]);

      const row = await fx.prisma.messageAttachment.findFirstOrThrow({
        where: { ticketId: ticket?.id },
      });
      expect(row.extractedText).toBe('# The steps I took');
    });

    it('**skips a path that fails its confirm, by name**, and keeps the ticket', async () => {
      confirmUpload.mockImplementation((objectPath: string) =>
        objectPath.includes('stranger')
          ? Promise.reject(
              new RpcException({ code: status.NOT_FOUND, message: 'gone' }),
            )
          : Promise.resolve({
              objectPath: objectPath.replace('/pending/', '/'),
              sizeBytes: PNG.length,
              contentType: 'image/png',
            }),
      );

      const { ticket, skippedAttachments } = await open([
        uploaded('mine.png'),
        { objectPath: 'organizations/x/stranger.png', fileName: 'theirs.png' },
      ]);

      expect(skippedAttachments).toEqual(['theirs.png']);
      expect(ticket?.attachments.map((file) => file.fileName)).toEqual([
        'mine.png',
      ]);
    });

    it('refuses more files than a message may carry, before confirming any', async () => {
      jest
        .spyOn(fx.moduleRef.get(AuthReferenceService), 'getAttachmentLimits')
        .mockResolvedValue({ maxBytes: 10_000_000, maxPerMessage: 1 });

      await expectRpc(
        open([uploaded('a.png'), uploaded('b.png')]),
        status.FAILED_PRECONDITION,
      );
      expect(confirmUpload).not.toHaveBeenCalled();
      expect(await fx.prisma.ticket.count()).toBe(0);
    });

    it('**a redelivered mail is refused before its files are confirmed**', async () => {
      await open([uploaded('first.png')], {
        source: TicketSource.TICKET_SOURCE_EMAIL,
        inboundMessageId: '<opening@mail.test>',
      });
      confirmUpload.mockClear();

      await expectRpc(
        open([uploaded('again.png')], {
          source: TicketSource.TICKET_SOURCE_EMAIL,
          inboundMessageId: '<opening@mail.test>',
        }),
        status.ALREADY_EXISTS,
      );
      // Unconfirmed, so the object stays under `pending/`.
      expect(confirmUpload).not.toHaveBeenCalled();
      expect(await fx.prisma.ticket.count()).toBe(1);
    });
  });

  it('**a redelivered reply is refused before its files are confirmed**', async () => {
    const { ticket } = await open([]);
    const reply = {
      ticketId: ticket!.id,
      content: 'And here is the log',
      isInternalNote: false,
      invokeAi: false,
      attachments: [uploaded('log.png')],
      inboundMessageId: '<reply@mail.test>',
    };
    await messages.createMessage(reply, requester());
    confirmUpload.mockClear();

    await expectRpc(
      messages.createMessage(
        { ...reply, attachments: [uploaded('log-again.png')] },
        requester(),
      ),
      status.ALREADY_EXISTS,
    );
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  describe('reading them', () => {
    it('the ticket carries its files on every read, the list included', async () => {
      const { ticket } = await open([uploaded('screen.png')]);

      const read = await tickets.getTicket({ id: ticket!.id }, requester());
      const list = await tickets.listTickets(
        { page: pageRequest(), includeDeleted: false } as never,
        requester(),
      );

      expect(read.attachments.map((file) => file.fileName)).toEqual([
        'screen.png',
      ]);
      expect(list.items[0].attachments.map((file) => file.fileName)).toEqual([
        'screen.png',
      ]);
    });

    it('**downloads and deletes an opening file**; another tenant gets NOT_FOUND', async () => {
      const { ticket } = await open([uploaded('screen.png')]);
      const attachmentId = ticket!.attachments[0].id;
      jest
        .spyOn(storage, 'resolveReadUrls')
        .mockImplementation((paths: string[]) =>
          Promise.resolve(
            Object.fromEntries(paths.map((path) => [path, 'https://signed'])),
          ),
        );
      const stranger = memberContext(
        { id: faker.string.uuid(), organizationId: faker.string.uuid() },
        ['ticket.read.all', 'ticket.message.moderate'],
      );

      await expect(
        messages.downloadAttachment({ attachmentId }, requester()),
      ).resolves.toMatchObject({ downloadUrl: 'https://signed' });
      await expectRpc(
        messages.downloadAttachment({ attachmentId }, stranger),
        status.NOT_FOUND,
      );
      await expectRpc(
        messages.deleteAttachment({ attachmentId }, stranger),
        status.NOT_FOUND,
      );

      await messages.deleteAttachment(
        { attachmentId },
        agent(['ticket.message.moderate']),
      );
      expect(await fx.prisma.messageAttachment.count()).toBe(0);
    });
  });

  describe('the AI reads them', () => {
    it('**the first answer sends the opening’s files**', async () => {
      const { ticket } = await open([uploaded('screen.png')]);

      await messages.answerOpening({ ticketId: ticket!.id }, requester());
      await draftRequested();

      expect(partsSent()).toEqual([
        expect.objectContaining({ fileName: 'screen.png', data: PNG }),
      ]);
    });

    it('**Classify reads them**', async () => {
      const { ticket } = await open([uploaded('screen.png')]);
      jest
        .spyOn(fx.moduleRef.get(AuthReferenceService), 'listDepartments')
        .mockResolvedValue([]);
      const classify = jest.spyOn(rag, 'classifyTicket').mockResolvedValue({
        priority: 'HIGH',
        departmentId: '',
        confidence: 0.9,
        reasoning: 'From the screenshot',
      } as never);

      await ai.classifyTicket({ ticketId: ticket!.id }, agent());

      expect(JSON.stringify(classify.mock.calls[0])).toContain('screen.png');
    });

    it('**once a user message exists, a draft reads that, not the opening**', async () => {
      const { ticket } = await open([uploaded('screen.png')]);
      await createMessage(fx.prisma, ticket!.id, { senderId: tenant.userId });

      const { parts } = await aiAttachments.forLastUserMessage(
        ticket!.id,
        requester(),
      );

      expect(parts).toEqual([]);
    });

    it('**a refused first answer keeps the opening’s files out of the next draft**', async () => {
      const { ticket } = await open([uploaded('injection.png')]);
      generateReplyDraft.mockRejectedValueOnce(
        new RpcException({
          code: status.FAILED_PRECONDITION,
          message:
            '[http:422] This message was refused and no draft was produced',
        }),
      );

      await messages.answerOpening({ ticketId: ticket!.id }, requester());
      await draftRequested();
      let flagged = false;
      for (let tries = 0; tries < 50 && !flagged; tries++) {
        flagged = (
          await fx.prisma.ticket.findUniqueOrThrow({
            where: { id: ticket!.id },
          })
        ).openingExcludedFromAiContext;
        if (!flagged) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(flagged).toBe(true);

      await ai.generateDraft(
        { ticketId: ticket!.id, instruction: undefined },
        agent(),
      );

      expect(partsSent(1)).toEqual([]);
    });
  });
});

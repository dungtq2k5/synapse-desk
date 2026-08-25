import { faker } from '@faker-js/faker';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import {
  buildTenant,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { memberContext } from '../utils/context';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { AttachmentExtractorClient } from '../../src/modules/ai-client/attachment-extractor.client';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';

/**
 * Binding attachments AT CREATE.
 *
 * Presign and confirm both took a `messageId`, so a row could only be written
 * after its message existed, while `invokeAi` runs during the create: a
 * first-turn screenshot was stored a moment after the answer that needed it.
 * Binding here leaves no ordering for a client to get wrong — which is what
 * makes this a structural fix rather than a client contract that a slow upload
 * quietly breaks.
 *
 * The confirms are stubbed. storage-service's own refusals belong to its suite;
 * what is provable here is the ORDER and the OUTCOME — that no transaction is
 * open across a network call, and that a failed confirm costs one file rather
 * than the message.
 */
describe('Attachments bound at message create (e2e)', () => {
  let fx: E2eFixture;
  let messages: MessagesService;
  let storage: StorageReferenceService;
  let confirmUpload: jest.SpyInstance;
  let presign: jest.SpyInstance;
  let extract: jest.SpyInstance;
  let tenant: TenantFixture;
  let extractor: AttachmentExtractorClient;

  const caller = () =>
    memberContext({ id: tenant.userId, organizationId: tenant.organizationId });

  const uploaded = (fileName: string) => ({
    objectPath: `organizations/${tenant.organizationId}/tickets/${faker.string.uuid()}/attachments/${faker.string.uuid()}.png`,
    fileName,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    messages = fx.moduleRef.get(MessagesService);
    storage = fx.moduleRef.get(StorageReferenceService);
    extractor = fx.moduleRef.get(AttachmentExtractorClient);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();

    confirmUpload = jest.spyOn(storage, 'confirmUpload').mockResolvedValue({
      // The COMMITTED path — the object left `pending/` on the way through,
      // and this is what the row must record.
      objectPath: 'organizations/o/tickets/t/attachments/committed.png',
      sizeBytes: 2048,
      contentType: 'image/png',
    });
    presign = jest.spyOn(storage, 'presignAttachment').mockResolvedValue({
      uploadUrl: 'https://storage.example/put',
      objectPath: 'organizations/o/tickets/t/attachments/f.png',
      expiresAt: new Date(),
    });
    // ingestion-service is a peer and is not running for this suite. The
    // default confirms `image/png`, which is not parse-eligible, so this stays
    // uncalled unless a test asks for a `.docx`.
    extract = jest.spyOn(extractor, 'extract');
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => fx.close());

  it('1. **a one-shot message carries its attachments into the same turn**', async () => {
    // The assertion this exists for. The rows are visible the instant the
    // message is — which is the instant `invokeAi` fires.
    const ticket = await createTicket(fx.prisma, tenant);

    const { message, skippedAttachments } = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'How can I solve this problem?',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('error.png')],
      },
      caller(),
    );

    expect(skippedAttachments).toEqual([]);
    expect(message?.attachments.map((a) => a.fileName)).toEqual(['error.png']);
  });

  it('**the row records the CONFIRMED path, not the presigned one**', async () => {
    // The client presigned into `pending/` and the object moved
    // out of it during confirm — so storing what the client sent would record
    // the one path a lifecycle sweep is entitled to delete, and the attachment
    // would resolve to nothing the first time somebody opened it.
    const ticket = await createTicket(fx.prisma, tenant);
    const presigned = {
      objectPath: `organizations/${tenant.organizationId}/tickets/${ticket.id}/attachments/pending/${faker.string.uuid()}.png`,
      fileName: 'error.png',
    };
    const committed = presigned.objectPath.replace('/pending/', '/');
    confirmUpload.mockResolvedValue({
      objectPath: committed,
      sizeBytes: 2048,
      contentType: 'image/png',
    });

    const { message } = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'Here is the error',
        isInternalNote: false,
        invokeAi: false,
        attachments: [presigned],
      },
      caller(),
    );

    expect(message?.attachments[0].fileUrl).toBe(committed);
    expect(message?.attachments[0].fileUrl).not.toContain('/pending/');
  });

  it('3. **a path that fails its confirm is named, and the message is created**', async () => {
    // The rule picks this over failing the create, and the reason is a rule this
    // codebase already set: a rollback here would throw away what a human typed
    // because a machine could not answer them.
    const ticket = await createTicket(fx.prisma, tenant);
    // What storage-service actually answers with. Its own suite proves it is
    // this code; here it is a stand-in for "the window closed".
    confirmUpload.mockRejectedValue(
      new RpcException({
        code: status.NOT_FOUND,
        message: 'No pending upload for that object path',
      }),
    );

    const { message, skippedAttachments } = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'Everything I typed must survive this',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('forged.png')],
      },
      caller(),
    );

    expect(skippedAttachments).toEqual(['forged.png']);
    expect(message?.content).toBe('Everything I typed must survive this');
    expect(message?.attachments).toEqual([]);
    await expect(
      fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
    ).resolves.toBe(1);
  });

  it('3b. **an EXPIRED presign is indistinguishable from a forged one**', async () => {
    // `confirmUpload` collapses "never presigned", "expired" and "already
    // confirmed once" into one NOT_FOUND on purpose, so at minute eleven an
    // honest slow typist looks exactly like an attacker. A property to preserve
    // rather than work around: the outcome must be the same named skip either
    // way, because no error message could be both honest and useful.
    const ticket = await createTicket(fx.prisma, tenant);
    const expired = new RpcException({
      code: status.NOT_FOUND,
      message: 'No pending upload for that object path',
    });

    confirmUpload.mockRejectedValue(expired);
    const slowTypist = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'Written over eleven careful minutes',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('screenshot.png')],
      },
      caller(),
    );

    confirmUpload.mockRejectedValue(expired);
    const forger = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'A path I never uploaded to',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('screenshot.png')],
      },
      caller(),
    );

    expect(slowTypist.skippedAttachments).toEqual(['screenshot.png']);
    expect(forger.skippedAttachments).toEqual(slowTypist.skippedAttachments);
    expect(forger.message?.attachments).toEqual(
      slowTypist.message?.attachments,
    );
  });

  it('**partial: the good file lands while the bad one is named**', async () => {
    // All-or-nothing would discard a screenshot that confirmed perfectly
    // because a second file's window had closed.
    const ticket = await createTicket(fx.prisma, tenant);
    confirmUpload
      .mockResolvedValueOnce({
        objectPath: 'organizations/o/tickets/t/attachments/good.png',
        sizeBytes: 1024,
        contentType: 'image/png',
      })
      .mockRejectedValueOnce(
        new RpcException({ code: status.NOT_FOUND, message: 'expired' }),
      );

    const { message, skippedAttachments } = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'Two files, one window closed',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('good.png'), uploaded('stale.png')],
      },
      caller(),
    );

    expect(message?.attachments.map((a) => a.fileName)).toEqual(['good.png']);
    expect(skippedAttachments).toEqual(['stale.png']);
  });

  describe('text extraction at confirm', () => {
    const DOCX =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const asDocx = () =>
      confirmUpload.mockResolvedValue({
        objectPath: 'organizations/o/tickets/t/attachments/committed.docx',
        sizeBytes: 2048,
        contentType: DOCX,
      });

    it('**6. a parse-eligible attachment is extracted through THIS path**', async () => {
      // The hook is in `confirmNewAttachments`, which both attachment routes
      // reach — and this is the nested one, which is what INBOUND EMAIL uses:
      // the Worker presigns, PUTs the bytes and sends paths, and they are
      // confirmed here as the message is written.
      //
      // Hooking `confirmAttachment` alone would have left every emailed office
      // attachment unextracted, permanently and silently, on the surface with
      // the least authentication behind it.
      asDocx();
      extract.mockResolvedValue('## Quote\n\nTotal: 42');
      const ticket = await createTicket(fx.prisma, tenant);

      const { message } = await messages.createMessage(
        {
          ticketId: ticket.id,
          content: 'see attached',
          isInternalNote: false,
          invokeAi: false,
          attachments: [uploaded('quote.docx')],
        },
        caller(),
      );

      const [row] = await fx.prisma.messageAttachment.findMany({
        where: { messageId: message?.id },
      });
      expect(row.extractedText).toBe('## Quote\n\nTotal: 42');
      // The CONFIRMED path and the CONFIRMED type — never what the client
      // declared, which is the same rule the columns beside it follow.
      expect(extract).toHaveBeenCalledWith(
        'organizations/o/tickets/t/attachments/committed.docx',
        DOCX,
        expect.anything(),
      );
    });

    it('**7. a failed extraction stores NULL and the confirm still succeeds**', async () => {
      // The trade the optional client already documents: an unset URL "makes
      // the outcome write fail and be logged, which costs a metric — not a
      // reply." An attachment the model cannot read is still a perfectly good
      // attachment for a human, and refusing the upload over it would be the
      // wrong direction.
      //
      // NULL rather than `''`: nothing was successfully extracted, and `''`
      // means a parser ran and the file genuinely had no text. Only a nullable
      // column can hold both.
      asDocx();
      extract.mockResolvedValue(null);
      const ticket = await createTicket(fx.prisma, tenant);

      const { message, skippedAttachments } = await messages.createMessage(
        {
          ticketId: ticket.id,
          content: 'see attached',
          isInternalNote: false,
          invokeAi: false,
          attachments: [uploaded('broken.docx')],
        },
        caller(),
      );

      // The file is NOT skipped — it stored fine, it is downloadable, and only
      // the model's view of it was lost.
      expect(skippedAttachments).toEqual([]);
      expect(message?.attachments).toHaveLength(1);

      const [row] = await fx.prisma.messageAttachment.findMany({
        where: { messageId: message?.id },
      });
      expect(row.extractedText).toBeNull();
    });

    it('**7. a corrupt workbook stores NULL and the confirm still succeeds**', async () => {
      // Doc 57's second format through doc 56 §B2's rule, and the chain matters:
      // exceljs THROWS on a file that is not a zip rather than yielding zero
      // sheets. Zero sheets would produce `''`, which means "a parser ran and
      // the file had no text" — the one state that must stay distinct from
      // "nothing was extracted".
      //
      // The throw becomes an `INTERNAL` rpc error, which the client swallows
      // into `null`. The attachment still stores, still downloads, and the user
      // loses only the model's view of it.
      confirmUpload.mockResolvedValue({
        objectPath: 'organizations/o/tickets/t/attachments/committed.xlsx',
        sizeBytes: 4096,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      extract.mockResolvedValue(null);
      const ticket = await createTicket(fx.prisma, tenant);

      const { message, skippedAttachments } = await messages.createMessage(
        {
          ticketId: ticket.id,
          content: 'the numbers',
          isInternalNote: false,
          invokeAi: false,
          attachments: [uploaded('corrupt.xlsx')],
        },
        caller(),
      );

      expect(skippedAttachments).toEqual([]);
      expect(message?.attachments).toHaveLength(1);

      const [row] = await fx.prisma.messageAttachment.findMany({
        where: { messageId: message?.id },
      });
      expect(row.extractedText).toBeNull();
    });

    it('**8. a type with no parser never costs a round trip**', async () => {
      // The eligibility check is on THIS side. Asking ingestion-service about a
      // `.png` would be a network hop to be told what
      // `PARSE_ELIGIBLE_MIME_TYPES` already says — the same filter-then-fetch
      // ordering the feed path is built on.
      const ticket = await createTicket(fx.prisma, tenant);

      await messages.createMessage(
        {
          ticketId: ticket.id,
          content: 'a screenshot',
          isInternalNote: false,
          invokeAi: false,
          attachments: [uploaded('error.png')],
        },
        caller(),
      );

      expect(extract).not.toHaveBeenCalled();
    });
  });

  it('4. **no transaction is OPEN while a confirm is in flight**', async () => {
    // It passes either way and only one way survives load: a network call
    // inside a Prisma transaction holds a pooled connection for the duration of
    // the slowest peer, and N of them multiply it.
    //
    // **Asserted as "was a transaction open", not as call order.** Two weaker
    // versions were tried first and neither bites. Counting rows from inside a
    // confirm proves nothing — an uncommitted row is invisible from another
    // connection whichever way the code is arranged. Asserting
    // confirm-before-write proves nothing either: wrapping the write in a
    // transaction and putting the confirms inside it produces exactly the same
    // order. Only the depth distinguishes them.
    const ticket = await createTicket(fx.prisma, tenant);
    const during: string[] = [];
    let openTransactions = 0;

    const originalTransaction = fx.prisma.$transaction.bind(fx.prisma);
    jest.spyOn(fx.prisma, '$transaction').mockImplementation((async (
      argument: never,
    ) => {
      openTransactions += 1;
      try {
        return await originalTransaction(argument);
      } finally {
        openTransactions -= 1;
      }
    }) as never);

    confirmUpload.mockImplementation(() => {
      during.push(
        openTransactions > 0 ? 'inside a transaction' : 'no transaction',
      );
      return Promise.resolve({
        objectPath: 'organizations/o/tickets/t/attachments/one.png',
        sizeBytes: 1024,
        contentType: 'image/png',
      });
    });

    const { message } = await messages.createMessage(
      {
        ticketId: ticket.id,
        content: 'Two files',
        isInternalNote: false,
        invokeAi: false,
        attachments: [uploaded('one.png'), uploaded('two.png')],
      },
      caller(),
    );

    expect(during).toEqual(['no transaction', 'no transaction']);
    // And the write still happened — "no transaction was open" would also be
    // true of a create that never wrote anything.
    expect(message?.attachments).toHaveLength(2);
  });

  it('refuses more attachments than a message may carry', async () => {
    // The cap presign used to enforce, moved to where the count is now known.
    // Without a message there is nothing to count against, so create is the
    // only place left that can see the whole list.
    const ticket = await createTicket(fx.prisma, tenant);

    await expectRpc(
      messages.createMessage(
        {
          ticketId: ticket.id,
          content: 'Too many',
          isInternalNote: false,
          invokeAi: false,
          attachments: Array.from(
            { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
            (_, i) => uploaded(`file-${i}.png`),
          ),
        },
        caller(),
      ),
      status.FAILED_PRECONDITION,
    );

    // Refused before any confirm — the same reason presign checked the cap
    // first: a caller over the limit should not pay for N round trips.
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  describe('presign', () => {
    it('5. the `:messageId` path still attaches to an existing message', async () => {
      // The route that must not regress while the new one lands.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);

      await messages.uploadAttachment(
        {
          ticketId: ticket.id,
          messageId: message.id,
          fileName: 'later.png',
          fileSizeBytes: 1024,
          mimeType: 'image/png',
        },
        caller(),
      );

      expect(presign).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: ticket.id, messageId: message.id }),
        expect.anything(),
      );
    });

    it('**presigns with NO message, which is what the one-shot case needs**', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await messages.uploadAttachment(
        {
          ticketId: ticket.id,
          messageId: undefined,
          fileName: 'error.png',
          fileSizeBytes: 1024,
          mimeType: 'image/png',
        },
        caller(),
      );

      expect(presign).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: ticket.id, messageId: undefined }),
        expect.anything(),
      );
    });

    it('**still refuses a ticket the caller cannot write to**', async () => {
      // `loadMessage` was carrying this check as a side effect. Dropping it for
      // the message-less path would let anyone presign into any ticket's
      // prefix — the one thing that must not fall out of making the id
      // optional.
      const stranger = buildTenant();
      const ticket = await createTicket(fx.prisma, tenant);

      await expect(
        messages.uploadAttachment(
          {
            ticketId: ticket.id,
            messageId: undefined,
            fileName: 'error.png',
            fileSizeBytes: 1024,
            mimeType: 'image/png',
          },
          memberContext({
            id: stranger.userId,
            organizationId: stranger.organizationId,
          }),
        ),
      ).rejects.toBeDefined();

      expect(presign).not.toHaveBeenCalled();
    });
  });
});

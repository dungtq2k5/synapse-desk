import { faker } from '@faker-js/faker';
import { requireField } from '@synapsedesk/grpc-proto';
import {
  AI_ELIGIBLE_MIME_TYPES,
  MAX_AI_ATTACHMENT_BYTES,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import {
  buildTenant,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { memberContext } from '../utils/context';
import { AiAttachmentService } from '../../src/modules/ai-attachments/ai-attachment.service';
import { AiService } from '../../src/modules/ai/ai.service';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { RagClientService } from '../../src/modules/ai-client/rag-client.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';

/**
 * Filter, THEN fetch — 36-doc §2.
 *
 * The order is the design rather than a detail: `mimeType` and `fileSizeBytes`
 * are on the row, so an ineligible file is rejected without a download.
 * Filtering after fetching would produce the same parts and pay for every zip a
 * user ever attached.
 *
 * These assert against the storage spy rather than the returned parts, because
 * "did not send it" and "did not fetch it" are different properties and only
 * the second one costs money.
 */
describe('§36 attachments as model input (e2e)', () => {
  let fx: E2eFixture;
  let service: AiAttachmentService;
  let storage: StorageReferenceService;
  let download: jest.SpyInstance;
  let confirmUpload: jest.SpyInstance;
  let tenant: TenantFixture;

  const caller = () =>
    memberContext({ id: tenant.userId, organizationId: tenant.organizationId });

  const attach = async (
    messageId: string,
    mimeType: string,
    sizeBytes: number,
    fileName = `${faker.string.alpha(6)}.bin`,
  ) =>
    fx.prisma.messageAttachment.create({
      data: {
        messageId,
        fileName,
        fileUrl: `organizations/${tenant.organizationId}/messages/${messageId}/${fileName}`,
        fileSizeBytes: BigInt(sizeBytes),
        mimeType,
      },
    });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    service = fx.moduleRef.get(AiAttachmentService);
    storage = fx.moduleRef.get(StorageReferenceService);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
    download = jest
      .spyOn(storage, 'downloadObject')
      .mockResolvedValue(Buffer.from('the file bytes'));
    // storage-service is a peer; what matters here is the ordering on this
    // side of the wire. Its own refusals are asserted in its suite.
    confirmUpload = jest.spyOn(storage, 'confirmUpload');
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => fx.close());

  it('1. **an ineligible type is never downloaded**', async () => {
    // The upload allowlist permits a zip; the model cannot read one. Two lists,
    // two questions — 35-doc §8.
    const ticket = await createTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id);
    await attach(message.id, 'application/zip', 1024, 'logs.zip');

    const result = await service.forMessage(message.id, caller());

    expect(download).not.toHaveBeenCalled();
    expect(result.parts).toEqual([]);
    expect(result.skipped).toEqual(['logs.zip']);
  });

  it('2. **past the ceiling is skipped, and earlier ones still go**', async () => {
    // Partial is correct. All-or-nothing would drop a good screenshot because a
    // large PDF happened to follow it.
    const ticket = await createTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id);
    await attach(message.id, 'image/png', 1024, 'screenshot.png');
    await attach(
      message.id,
      'application/pdf',
      MAX_AI_ATTACHMENT_BYTES,
      'huge.pdf',
    );

    const result = await service.forMessage(message.id, caller());

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].fileName).toBe('screenshot.png');
    expect(result.skipped).toEqual(['huge.pdf']);
    // And the oversized one cost nothing to reject.
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('3. the skipped list names the files, for telling the user', async () => {
    const ticket = await createTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id);
    await attach(message.id, 'application/zip', 512, 'evidence.zip');
    await attach(message.id, 'image/png', 512, 'error.png');

    const result = await service.forMessage(message.id, caller());

    expect(result.skipped).toEqual(['evidence.zip']);
    expect(result.parts.map((part) => part.fileName)).toEqual(['error.png']);
  });

  it('4. **a message with no attachments downloads nothing**', async () => {
    // The common path, and it must stay free.
    const ticket = await createTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id);

    const result = await service.forMessage(message.id, caller());

    expect(result).toEqual({ parts: [], skipped: [] });
    expect(download).not.toHaveBeenCalled();
  });

  it('an unreadable object is skipped, not fatal', async () => {
    // A missing object must not fail the question. The user asked something;
    // answering it without one file beats answering nothing.
    const ticket = await createTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id);
    await attach(message.id, 'image/png', 512, 'gone.png');
    download.mockRejectedValue(new Error('object not found'));

    const result = await service.forMessage(message.id, caller());

    expect(result.parts).toEqual([]);
    expect(result.skipped).toEqual(['gone.png']);
  });

  it('**the last USER message is what Draft replies to, not the last row**', async () => {
    // On a busy ticket the newest row is often the assistant's own reply, which
    // has no attachments — taking it would return empty for a customer
    // screenshot one row above.
    const ticket = await createTicket(fx.prisma, tenant);
    const question = await createMessage(fx.prisma, ticket.id);
    await attach(question.id, 'image/png', 512, 'customer.png');
    await createMessage(fx.prisma, ticket.id, {
      content: 'An AI answer came after it',
      isAiGenerated: true,
      senderId: null,
    });

    const result = await service.forLastUserMessage(ticket.id, caller());

    expect(result.parts.map((part) => part.fileName)).toEqual(['customer.png']);
  });

  /**
   * §2's fifth test — **both `Draft` call sites**, driven end to end.
   *
   * `generateReplyDraft` has exactly two callers and they are in different
   * modules, which is how the first draft of 36-doc came to name only the
   * co-pilot one. Parameterised rather than written twice, so a third caller
   * added tomorrow has an obvious place to land and no place to hide.
   *
   * The gateway's `Chat` site is the third, and it is asserted in the
   * api-gateway realtime suite — a different service, a different socket, and
   * nothing about it is provable from here.
   *
   * These stub `AiAttachmentService` rather than seeding rows, because the two
   * sites reach it at different moments in a ticket's life and the property
   * under test is the same for both: whatever the service returns is what
   * rag-service is given. The rows themselves are covered above; the moment is
   * covered by the ordering test that follows.
   */
  describe('both Draft call sites hand the bytes to rag-service', () => {
    let rag: RagClientService;
    let generateReplyDraft: jest.SpyInstance;

    const part = {
      mimeType: 'image/png',
      data: Buffer.from('PNG bytes'),
      fileName: 'error.png',
    };

    beforeEach(() => {
      rag = fx.moduleRef.get(RagClientService);
      jest.spyOn(rag, 'isAvailable', 'get').mockReturnValue(true);
      generateReplyDraft = jest
        .spyOn(rag, 'generateReplyDraft')
        .mockResolvedValue({
          content: 'A suggested reply',
          // Not a real model name, deliberately: `check-model-literals.mjs`
          // forbids one anywhere in this service, tests included, and it caught
          // this line the first time it said something plausible. What the
          // stub returns here is never read.
          modelName: 'whatever-rag-service-resolved',
          promptTokens: 10,
          completionTokens: 5,
          generationId: faker.string.uuid(),
          citations: [],
        });

      jest
        .spyOn(service, 'forLastUserMessage')
        .mockResolvedValue({ parts: [part], skipped: [] });
    });

    const sites = [
      {
        name: 'the co-pilot Draft an agent asks for',
        run: async (ticketId: string) => {
          await fx.moduleRef
            .get(AiService)
            .generateDraft(
              { ticketId, instruction: undefined },
              memberContext(
                { id: tenant.agentId, organizationId: tenant.organizationId },
                ['ticket.read.all'],
              ),
            );
        },
      },
      {
        name: '**the `invokeAi` auto-reply**, which answers a customer directly',
        run: async (ticketId: string) => {
          await fx.moduleRef.get(MessagesService).createMessage(
            {
              ticketId,
              content: 'What does this error mean?',
              isInternalNote: false,
              invokeAi: true,
              attachments: [],
            },
            caller(),
          );
        },
      },
    ];

    it.each(sites)('$name', async ({ run }) => {
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id, { senderId: tenant.userId });

      await run(ticket.id);

      expect(generateReplyDraft).toHaveBeenCalled();
      // The fifth positional argument, which is where the parts go. Asserted by
      // position because that is what a caller passing them in the wrong slot
      // would get wrong, and the types alone would not catch it: `reviewPasses`
      // sits directly before it.
      expect(generateReplyDraft.mock.calls[0][4]).toEqual([part]);
    });
  });

  /**
   * **§1.3 test 2 — this test used to assert the opposite, and that was the
   * bug.**
   *
   * Presign and confirm both took a `messageId`, so an attachment row could only
   * be written after its message existed, while `invokeAi` runs during the
   * create. The pinned version of this test recorded that a same-turn
   * attachment could never reach the same-turn answer — the exact failure
   * 35-doc §1 opens with, arriving through a different door.
   *
   * Inverted rather than deleted. It documented the bug; it is now the
   * assertion that the fix holds, and if the binding ever moves back out of
   * `createMessage` this is what says so.
   */
  it('an attachment bound AT CREATE is visible to that turn', async () => {
    const ticket = await createTicket(fx.prisma, tenant);
    const objectPath = `organizations/${tenant.organizationId}/tickets/${ticket.id}/attachments/pending/${faker.string.uuid()}.png`;
    confirmUpload.mockResolvedValue({
      // Out of `pending/` — 36-doc §1.3.2.
      objectPath: objectPath.replace('/pending/', '/'),
      sizeBytes: 2048,
      contentType: 'image/png',
    });

    const { message, skippedAttachments } = await fx.moduleRef
      .get(MessagesService)
      .createMessage(
        {
          ticketId: ticket.id,
          content: 'How do I solve this?',
          isInternalNote: false,
          invokeAi: false,
          attachments: [{ objectPath, fileName: 'error.png' }],
        },
        caller(),
      );

    expect(skippedAttachments).toEqual([]);

    // The row exists the instant the message does — which is the instant
    // `invokeAi` would have fired.
    const seen = await service.forMessage(
      requireField(message, 'message').id,
      caller(),
    );
    expect(seen.parts.map((part) => part.fileName)).toEqual(['error.png']);
  });

  it('every AI-eligible type is a subset of what may be uploaded', async () => {
    // Two lists that answer different questions, and the capability one must
    // never permit something the security one refuses.
    const { ALLOWED_ATTACHMENT_MIME_TYPES } =
      await import('@synapsedesk/common');

    for (const mime of AI_ELIGIBLE_MIME_TYPES) {
      expect(ALLOWED_ATTACHMENT_MIME_TYPES).toContain(mime);
    }
  });
});

import { faker } from '@faker-js/faker';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export function buildMessage(
  ticketId: string,
  overrides: Partial<Prisma.TicketMessageUncheckedCreateInput> = {},
): Prisma.TicketMessageUncheckedCreateInput {
  return {
    ticketId,
    senderId: faker.string.uuid(),
    content: faker.lorem.sentences(2),
    isAiGenerated: false,
    isInternalNote: false,
    ...overrides,
  };
}

export function createMessage(
  prisma: PrismaService,
  ticketId: string,
  overrides: Partial<Prisma.TicketMessageUncheckedCreateInput> = {},
) {
  return prisma.ticketMessage.create({
    data: buildMessage(ticketId, overrides),
  });
}

/**
 * An AI reply: no sender, and the token columns populated.
 *
 * `senderId: null` is the point — attributing a generated message to a real
 * person would put words in their mouth in the audit trail, so the absence is
 * meaningful rather than incidental.
 */
export function createAiMessage(
  prisma: PrismaService,
  ticketId: string,
  overrides: Partial<Prisma.TicketMessageUncheckedCreateInput> = {},
) {
  return prisma.ticketMessage.create({
    data: buildMessage(ticketId, {
      senderId: null,
      isAiGenerated: true,
      modelName: 'test-model-v1',
      promptTokens: 120,
      completionTokens: 80,
      ...overrides,
    }),
  });
}

export function createAttachment(
  prisma: PrismaService,
  messageId: string,
  overrides: Partial<Prisma.MessageAttachmentUncheckedCreateInput> = {},
) {
  return prisma.messageAttachment.create({
    data: {
      messageId,
      fileName: `${faker.system.commonFileName('pdf')}`,
      fileUrl: faker.internet.url(),
      fileSizeBytes: BigInt(1024),
      mimeType: 'application/pdf',
      ...overrides,
    },
  });
}

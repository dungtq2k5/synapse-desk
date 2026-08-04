import { faker } from '@faker-js/faker';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export function createAiSummary(
  prisma: PrismaService,
  ticketId: string,
  overrides: Partial<Prisma.AiSummaryUncheckedCreateInput> = {},
) {
  return prisma.aiSummary.create({
    data: {
      ticketId,
      summaryText: faker.lorem.paragraph(),
      suggestedAction: faker.lorem.sentence(),
      confidenceScore: 0.87,
      modelName: 'test-model-v1',
      ...overrides,
    },
  });
}

/**
 * Feedback carries `organizationId` because the list endpoint scopes on it
 * directly rather than joining back through messages to tickets — the same
 * denormalization `tickets.current_assignee_id` makes, for the same reason.
 */
export function createFeedback(
  prisma: PrismaService,
  opts: {
    ticketMessageId: string;
    userId: string;
    organizationId: string;
    overrides?: Partial<Prisma.AiResponseFeedbackUncheckedCreateInput>;
  },
) {
  return prisma.aiResponseFeedback.create({
    data: {
      ticketMessageId: opts.ticketMessageId,
      userId: opts.userId,
      organizationId: opts.organizationId,
      rating: 1,
      ...opts.overrides,
    },
  });
}

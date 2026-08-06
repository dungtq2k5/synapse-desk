import { faker } from '@faker-js/faker';
import { randomBytes } from 'node:crypto';
import { InvitationStatus } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { addDays, hashToken } from '../../src/common/utils';

let inviteIdx = 0;

/** Returns the raw token too — the emailed link is the only place it exists. */
export async function createInvitation(
  prisma: PrismaService,
  organizationId: string,
  overrides: Partial<Prisma.UserInvitationUncheckedCreateInput> = {},
) {
  inviteIdx++;
  const token = randomBytes(32).toString('base64url');

  const row = await prisma.userInvitation.create({
    data: {
      organizationId,
      email: `invitee${inviteIdx}.${faker.string.alphanumeric(6).toLowerCase()}@example.test`,
      tokenHash: hashToken(token),
      status: InvitationStatus.PENDING,
      roleIds: [],
      departmentIds: [],
      expiresAt: addDays(new Date(), 7),
      ...overrides,
    },
  });

  return { row, token };
}

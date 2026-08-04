import { faker } from '@faker-js/faker';
import {
  ReassignmentReason,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * A tenant, in Domain B, is just a uuid.
 *
 * There is no `organizations` table in this database to create a row in — the
 * tenant lives in postgres_auth and reaches this service only as an id in gRPC
 * metadata. A fixture that tried to "create a tenant" here would be inventing a
 * table that must not exist.
 */
export type TenantFixture = {
  organizationId: string;
  /** The tenant's ordinary member — author of most fixture tickets. */
  userId: string;
  /** An agent in that tenant, for assignment fixtures. */
  agentId: string;
  departmentId: string;
};

export function buildTenant(
  overrides: Partial<TenantFixture> = {},
): TenantFixture {
  return {
    organizationId: faker.string.uuid(),
    userId: faker.string.uuid(),
    agentId: faker.string.uuid(),
    departmentId: faker.string.uuid(),
    ...overrides,
  };
}

let ticketIdx = 0;

export function buildTicket(
  tenant: TenantFixture,
  overrides: Partial<Prisma.TicketUncheckedCreateInput> = {},
): Prisma.TicketUncheckedCreateInput {
  ticketIdx++;
  return {
    organizationId: tenant.organizationId,
    authorId: tenant.userId,
    source: TicketSource.WEB,
    // NEW rather than OPEN: it is the real default a created ticket carries, and
    // a fixture that quietly started them OPEN would make every state-machine
    // test begin from a state the application never produces on its own.
    status: TicketStatus.NEW,
    priority: TicketPriority.MEDIUM,
    title: `${faker.hacker.phrase()} (${ticketIdx})`,
    description: faker.lorem.paragraph(),
    ...overrides,
  };
}

export function createTicket(
  prisma: PrismaService,
  tenant: TenantFixture,
  overrides: Partial<Prisma.TicketUncheckedCreateInput> = {},
) {
  return prisma.ticket.create({ data: buildTicket(tenant, overrides) });
}

/**
 * A ticket that already has a live assignment — the assignment row AND the two
 * denormalized columns on `tickets`, together.
 *
 * Together on purpose: setting only one of them is the single most likely bug
 * in this module, so a fixture that produced that state would make a passing
 * test meaningless.
 */
export async function createAssignedTicket(
  prisma: PrismaService,
  tenant: TenantFixture,
  overrides: Partial<Prisma.TicketUncheckedCreateInput> = {},
) {
  const ticket = await createTicket(prisma, tenant, {
    status: TicketStatus.OPEN,
    currentAssigneeId: tenant.agentId,
    currentDepartmentId: tenant.departmentId,
    ...overrides,
  });

  const assignment = await prisma.ticketAssignment.create({
    data: {
      ticketId: ticket.id,
      assignedToId: ticket.currentAssigneeId!,
      assignedById: tenant.agentId,
      departmentId: ticket.currentDepartmentId!,
      reason: ReassignmentReason.INITIAL,
      isCurrent: true,
    },
  });

  return { ticket, assignment };
}

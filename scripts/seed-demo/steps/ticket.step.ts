/**
 * @file Tickets and their first message.
 *
 * Second in the order: every row here names an `organization_id`, an
 * `author_id` and a `department_id` that only `postgres_auth` can create, and
 * none of them carries a foreign key. **Every id comes from the manifest** —
 * a step that generated its own would write rows unreachable through the API
 * and invisible to every constraint.
 */

import { faker } from '@faker-js/faker';
import { TicketStatus } from '@synapsedesk/common';
import {
  buildMessage,
  buildTenant,
  buildTicket,
} from '../../../apps/ticket-service/test/factories';
import type { PrismaService } from '../../../apps/ticket-service/src/modules/prisma/prisma.service';
import type { ManifestTenant } from '../manifest';
import type { Profile } from '../profiles';
import { tenantsOf, type SeedStep } from '../registry';

const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

/** A spread, so a board has something in every column. */
const STATUSES: readonly TicketStatus[] = [
  TicketStatus.NEW,
  TicketStatus.OPEN,
  TicketStatus.PENDING_AGENT,
  TicketStatus.ESCALATED,
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

/** How many tickets one tenant gets — derived from its seeded user count. */
export function ticketCountFor(
  tenant: ManifestTenant,
  profile: Profile,
): number {
  const perUser = faker.number.int({
    min: profile.ticketsPerUser[0],
    max: profile.ticketsPerUser[1],
  });

  return tenant.userIds.length * perUser;
}

export const ticketStep: SeedStep = {
  service: 'ticket',
  run: (context) =>
    seedTickets(
      context.clients.ticket,
      tenantsOf(context),
      context.profile,
      context.apply,
    ),
};

export async function seedTickets(
  prisma: PrismaService,
  tenants: ManifestTenant[],
  profile: Profile,
  apply: boolean,
): Promise<string[]> {
  const lines: string[] = [];

  for (const tenant of tenants) {
    const count = ticketCountFor(tenant, profile);
    lines.push(
      `${tenant.slug.padEnd(24)} ${String(count).padStart(4)} tickets`,
    );

    if (!apply) continue;

    await prisma.$transaction(
      async (tx) => writeTickets(tx as PrismaService, tenant, count),
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );
  }

  return lines;
}

async function writeTickets(
  tx: PrismaService,
  tenant: ManifestTenant,
  count: number,
): Promise<void> {
  // `buildTenant` is the factory's own answer to "a tenant, in this database,
  // is a set of uuids" — the ids are handed IN rather than invented.
  const fixture = buildTenant({
    organizationId: tenant.organizationId,
    userId: tenant.userIds[0],
    agentId: tenant.adminUserId,
    departmentId: tenant.departmentIds[0],
  });

  const tickets = Array.from({ length: count }, (_, index) =>
    buildTicket(
      {
        ...fixture,
        // Rotate the author across the tenant's real users, so a demo board
        // does not show one person filing everything.
        userId: tenant.userIds[index % tenant.userIds.length],
      },
      {
        status: STATUSES[index % STATUSES.length],
        createdAt: faker.date.recent({ days: 90 }),
      },
    ),
  );

  // **`createManyAndReturn`, not `createMany` then a re-read.** The messages
  // need the generated ids, and fetching every ticket for the tenant would pick
  // up EARLIER runs' rows too — so a second `--only=ticket` would hang a fresh
  // message on every ticket already there. Returning the rows it just wrote is
  // the version that cannot do that.
  const written = await tx.ticket.createManyAndReturn({
    data: tickets,
    select: { id: true, authorId: true },
  });

  await tx.ticketMessage.createMany({
    data: written.map((ticket) =>
      buildMessage(ticket.id, { senderId: ticket.authorId }),
    ),
  });
}

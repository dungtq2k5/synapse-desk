/**
 * @file Tickets, their conversation, and the history the dashboards count.
 *
 * Second in the order: every row here names an `organization_id`, an
 * `author_id` and a `department_id` that only `postgres_auth` can create, and
 * none of them carries a foreign key. **Every id comes from the manifest** —
 * a step that generated its own would write rows unreachable through the API
 * and invisible to every constraint.
 */

import { faker } from '@faker-js/faker';
import {
  ReassignmentReason,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/contracts';
import {
  buildMessage,
  buildTenant,
  buildTicket,
} from '../../../services/ticket-service/test/factories';
import type { Prisma } from '../../../services/ticket-service/src/generated/prisma/client';
import type { PrismaService } from '../../../services/ticket-service/src/modules/prisma/prisma.service';
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

const MINUTE = 60_000;

/** `minutes` after `from`, never past now: a seeded event can't be in the future. */
function after(from: Date, minutes: number): Date {
  return new Date(Math.min(from.getTime() + minutes * MINUTE, Date.now()));
}

/**
 * Who answers: the admin and the users the auth step made agents. Never the
 * ticket's own author, whose replies a rollup doesn't count as a response.
 */
function agentFor(tenant: ManifestTenant, authorId: string, index: number) {
  const agents = tenant.agentIds ?? [tenant.adminUserId];
  const others = agents.filter((id) => id !== authorId);
  return others.length ? others[index % others.length] : null;
}

/**
 * One ticket's life as the dashboards read it: when it was resolved or
 * escalated, who held it, the first reply, and for a chat the AI's answer and
 * the rating it got. A chat that resolved with no person is deflected.
 */
export function historyFor(
  tenant: ManifestTenant,
  ticket: {
    id: string;
    authorId: string;
    status: string;
    source: string;
    createdAt: Date;
  },
  index: number,
) {
  // Typed: the rows carry the enums' values as plain strings.
  const status = ticket.status as TicketStatus;
  const terminal =
    status === TicketStatus.RESOLVED || status === TicketStatus.CLOSED;
  const chat = (ticket.source as TicketSource) === TicketSource.CHAT;
  const escalated = status === TicketStatus.ESCALATED;
  const deflected = chat && terminal;
  const agent =
    deflected || status === TicketStatus.NEW
      ? null
      : agentFor(tenant, ticket.authorId, index);

  const assignedAt = after(
    ticket.createdAt,
    faker.number.int({ min: 2, max: 45 }),
  );
  const repliedAt = after(assignedAt, faker.number.int({ min: 5, max: 600 }));
  const update: Prisma.TicketUncheckedUpdateInput = {
    currentAssigneeId: agent,
    escalatedAt: escalated
      ? after(ticket.createdAt, faker.number.int({ min: 1, max: 120 }))
      : null,
    resolvedAt: terminal
      ? after(repliedAt, faker.number.int({ min: 30, max: 72 * 60 }))
      : null,
  };
  const assignment: Prisma.TicketAssignmentUncheckedCreateInput | null =
    agent && tenant.departmentIds[0]
      ? {
          ticketId: ticket.id,
          assignedToId: agent,
          assignedById: tenant.adminUserId,
          departmentId: tenant.departmentIds[0],
          assignedAt,
          reason: ReassignmentReason.INITIAL,
          isCurrent: true,
        }
      : null;
  const messages: Prisma.TicketMessageUncheckedCreateInput[] = [];
  if (chat) {
    messages.push(
      buildMessage(ticket.id, {
        senderId: null,
        isAiGenerated: true,
        createdAt: after(ticket.createdAt, 0.1),
      }),
    );
  }
  if (agent) {
    messages.push(
      buildMessage(ticket.id, { senderId: agent, createdAt: repliedAt }),
    );
  }
  return { update, assignment, messages, rated: chat };
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
        // One in four through the chat, so deflection has conversations.
        source: index % 4 === 0 ? TicketSource.CHAT : TicketSource.WEB,
        currentDepartmentId: tenant.departmentIds[0],
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
    select: {
      id: true,
      authorId: true,
      status: true,
      source: true,
      createdAt: true,
    },
  });

  await tx.ticketMessage.createMany({
    data: written.map((ticket) =>
      buildMessage(ticket.id, {
        senderId: ticket.authorId,
        createdAt: ticket.createdAt,
      }),
    ),
  });

  const histories = written.map((ticket, index) =>
    historyFor(tenant, ticket, index),
  );
  for (const [index, history] of histories.entries()) {
    await tx.ticket.update({
      where: { id: written[index].id },
      data: history.update,
    });
  }
  await tx.ticketAssignment.createMany({
    data: histories.flatMap((history) =>
      history.assignment ? [history.assignment] : [],
    ),
  });
  const replies = await tx.ticketMessage.createManyAndReturn({
    data: histories.flatMap((history) => history.messages),
    select: { id: true, ticketId: true, isAiGenerated: true, createdAt: true },
  });

  // Ratings on most AI answers, by the person who asked: the satisfaction
  // chart, citation accuracy and the Feedback list read these.
  const authors = new Map(
    written.map((ticket) => [ticket.id, ticket.authorId]),
  );
  await tx.aiResponseFeedback.createMany({
    data: replies
      .filter((reply) => reply.isAiGenerated && faker.number.float() < 0.7)
      .map((reply) => {
        const helpful = faker.number.float() < 0.75;
        return {
          ticketMessageId: reply.id,
          userId: authors.get(reply.ticketId) ?? tenant.adminUserId,
          organizationId: tenant.organizationId,
          rating: helpful ? 1 : -1,
          feedbackText:
            faker.number.float() < 0.4 ? faker.lorem.sentence() : null,
          citationAccurate: faker.helpers.arrayElement([
            true,
            true,
            false,
            null,
          ]),
          createdAt: after(
            reply.createdAt,
            faker.number.int({ min: 1, max: 30 }),
          ),
        };
      }),
  });

  // The AI ledger's answers name these, so the ingestion step reads them here.
  tenant.chatTicketIds = written
    .filter((ticket) => (ticket.source as TicketSource) === TicketSource.CHAT)
    .map((ticket) => ticket.id);
}

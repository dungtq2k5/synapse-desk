import { ReassignmentReason } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * `isCurrent` defaults to FALSE.
 *
 * `ticket_assignments_current_key` is a partial unique index on
 * `(ticket_id) WHERE is_current = true`, so a factory that defaulted to true
 * would fail on the second call for one ticket — in a test about something
 * else. Building history is the common case; the live row is the exception a
 * test states explicitly.
 */
export function createAssignment(
  prisma: PrismaService,
  ticketId: string,
  opts: {
    assignedToId: string;
    departmentId: string;
    assignedById?: string;
    overrides?: Partial<Prisma.TicketAssignmentUncheckedCreateInput>;
  },
) {
  return prisma.ticketAssignment.create({
    data: {
      ticketId,
      assignedToId: opts.assignedToId,
      assignedById: opts.assignedById ?? null,
      departmentId: opts.departmentId,
      reason: ReassignmentReason.INITIAL,
      isCurrent: false,
      ...opts.overrides,
    },
  });
}

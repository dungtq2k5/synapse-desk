import { ReassignmentReason } from '@synapsedesk/common';

/**
 * One entry in a ticket's assignment history.
 *
 * `unassignedAt` null and `isCurrent` true identify the live one — and exactly
 * one entry can be in that state, enforced by a partial unique index rather
 * than by the code that writes it.
 */
export class AssignmentResponseDto {
  id!: string;
  ticketId!: string;
  assignedToId!: string;
  /** null when the system assigned it — auto-routing or an escalation rule. */
  assignedById!: string | null;
  departmentId!: string;
  assignedAt!: Date;
  unassignedAt!: Date | null;
  reason!: ReassignmentReason | null;
  isCurrent!: boolean;
  createdAt!: Date;
}

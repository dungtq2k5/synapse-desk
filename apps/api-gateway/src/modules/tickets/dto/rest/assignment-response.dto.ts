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
  /**
   * Who assigned it. Always a person.
   *
   * Was `string | null`; the null had no writer — `writeAssignment` is the only
   * one and takes an actor (known-gaps #12). Part of the pre-client clearing —
   * see `PaginationDto`.
   */
  assignedById!: string;
  departmentId!: string;
  assignedAt!: Date;
  unassignedAt!: Date | null;
  reason!: ReassignmentReason | null;
  isCurrent!: boolean;
  createdAt!: Date;
}

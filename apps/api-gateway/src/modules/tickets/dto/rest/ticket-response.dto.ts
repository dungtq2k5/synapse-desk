import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';

/**
 * A ticket as the REST API returns it.
 *
 * Every optional field is `| null`, never absent, so the key set is the same on
 * every row. The GraphQL `type Ticket` is the independent
 * `TicketResponseGqlDto`.
 */
export class TicketResponseDto {
  id!: string;
  /** A number, not a string: `longs: Number` keeps int64 exact to 2^53. */
  ticketNumber!: number;
  organizationId!: string;
  authorId!: string;
  source!: TicketSource | null;
  status!: TicketStatus | null;
  priority!: TicketPriority | null;
  title!: string;
  description!: string;
  currentAssigneeId!: string | null;
  currentDepartmentId!: string | null;
  escalatedAt!: Date | null;
  resolvedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
  deletedById!: string | null;
}

/** The partial-success shape a bulk operation returns. */
export class BulkTicketFailureResponseDto {
  id!: string;
  reason!: string;
}

export class BulkTicketStatusResponseDto {
  updated!: string[];
  failed!: BulkTicketFailureResponseDto[];
}

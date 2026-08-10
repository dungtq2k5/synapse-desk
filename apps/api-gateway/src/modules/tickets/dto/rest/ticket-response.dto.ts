import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';

/**
 * A ticket as the REST API returns it.
 *
 * **REST only.** The schema's `type Ticket` is `TicketResponseGqlDto` in
 * `../graphql/`, an independent class — `ticket-response.contract.spec.ts`
 * asserts the two field sets agree so the duplication cannot drift.
 *
 * Every optional field is `| null`, never absent: protobuf has no null so the
 * wire type uses `undefined`, and passing that through would give a client a
 * key set that changes per row. A stable shape is what an OpenAPI schema and a
 * typed client both need.
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
export class BulkTicketFailureDto {
  id!: string;
  reason!: string;
}

export class BulkTicketStatusResponseDto {
  updated!: string[];
  failed!: BulkTicketFailureDto[];
}

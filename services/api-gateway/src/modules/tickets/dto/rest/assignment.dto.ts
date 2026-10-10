import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ReassignmentReason } from '@synapsedesk/common';

export class AssignTicketDto {
  @IsUUID('4')
  readonly assigneeId!: string;

  /**
   * Required, not inferred from the assignee's primary department.
   *
   * Inferring it would put the ticket wherever that agent happens to sit, which
   * is wrong the moment someone belongs to two teams — and it would make the
   * queue a ticket lands in depend on a fact about a PERSON rather than a
   * decision about the WORK. Both ids are validated against auth-service before
   * anything is written.
   */
  @IsUUID('4')
  readonly departmentId!: string;

  /**
   * Why it moved. Absent means the service decides from context: `INITIAL` for
   * a first assignment, `MANUAL` for any later one.
   */
  @IsOptional()
  @IsIn(Object.values(ReassignmentReason))
  readonly reason?: ReassignmentReason;
}

/** Claiming from a queue: the assignee is the caller, so only the team is asked for. */
export class AssignTicketToSelfDto {
  @IsUUID('4')
  readonly departmentId!: string;
}

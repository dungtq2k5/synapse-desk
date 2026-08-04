import {
  AssignmentResponse,
  fromTimestamp,
  ReassignmentReason as ProtoReassignmentReason,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import { ReassignmentReason } from '@synapsedesk/common';
import { AssignmentResponseDto } from './dto/rest/assignment-response.dto';

const REASON_BY_PROTO: Record<number, ReassignmentReason> = {
  [ProtoReassignmentReason.REASSIGNMENT_REASON_INITIAL]:
    ReassignmentReason.INITIAL,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_DEPARTMENT_CHANGE]:
    ReassignmentReason.DEPARTMENT_CHANGE,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION]:
    ReassignmentReason.ESCALATION,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_UNAVAILABLE]:
    ReassignmentReason.UNAVAILABLE,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_LOAD_BALANCING]:
    ReassignmentReason.LOAD_BALANCING,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED]:
    ReassignmentReason.SELF_ASSIGNED,
  [ProtoReassignmentReason.REASSIGNMENT_REASON_MANUAL]:
    ReassignmentReason.MANUAL,
};

const PROTO_BY_REASON: Record<ReassignmentReason, ProtoReassignmentReason> =
  Object.fromEntries(
    Object.entries(REASON_BY_PROTO).map(([proto, domain]) => [
      domain,
      Number(proto),
    ]),
  ) as Record<ReassignmentReason, ProtoReassignmentReason>;

export function toProtoReason(
  value?: ReassignmentReason,
): ProtoReassignmentReason {
  return value
    ? PROTO_BY_REASON[value]
    : ProtoReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED;
}

export function toAssignmentDto(
  assignment: AssignmentResponse,
): AssignmentResponseDto {
  return {
    id: assignment.id,
    ticketId: assignment.ticketId,
    assignedToId: assignment.assignedToId,
    assignedById: assignment.assignedById ?? null,
    departmentId: assignment.departmentId,
    assignedAt: requireTimestamp(assignment.assignedAt, 'assignedAt'),
    unassignedAt: fromTimestamp(assignment.unassignedAt) ?? null,
    reason: REASON_BY_PROTO[assignment.reason] ?? null,
    isCurrent: assignment.isCurrent,
    createdAt: requireTimestamp(assignment.createdAt, 'createdAt'),
  };
}

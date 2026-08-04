import {
  AssignmentResponse,
  ReassignmentReason as ProtoReassignmentReason,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import { ReassignmentReason } from '@synapsedesk/common';
import { TicketAssignment } from '../../generated/prisma/client';

/**
 * The reason enum bridge, same discipline as `ticket.mapper.ts`.
 *
 * `ticket_assignments.reason` is a VarChar and the proto field is numeric, so
 * every crossing needs an explicit map. A bare cast compiles and writes a
 * number into a VarChar column, where it survives until somebody reads the
 * history and finds `3` where `ESCALATION` should be.
 */
const PROTO_REASON: Record<ReassignmentReason, ProtoReassignmentReason> = {
  [ReassignmentReason.INITIAL]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_INITIAL,
  [ReassignmentReason.DEPARTMENT_CHANGE]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_DEPARTMENT_CHANGE,
  [ReassignmentReason.ESCALATION]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_ESCALATION,
  [ReassignmentReason.UNAVAILABLE]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_UNAVAILABLE,
  [ReassignmentReason.LOAD_BALANCING]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_LOAD_BALANCING,
  [ReassignmentReason.SELF_ASSIGNED]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_SELF_ASSIGNED,
  [ReassignmentReason.MANUAL]:
    ProtoReassignmentReason.REASSIGNMENT_REASON_MANUAL,
};

const DOMAIN_REASON: Record<number, ReassignmentReason> = Object.fromEntries(
  Object.entries(PROTO_REASON).map(([domain, proto]) => [proto, domain]),
) as Record<number, ReassignmentReason>;

export function toProtoReason(value: string): ProtoReassignmentReason {
  return (
    PROTO_REASON[value as ReassignmentReason] ??
    ProtoReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED
  );
}

/**
 * Null for UNSPECIFIED and for anything unrecognised.
 *
 * Null rather than a default, because the DEFAULT depends on context the mapper
 * cannot see: a first assignment defaults to `INITIAL`, a later one to
 * `MANUAL`, and a self-claim to `SELF_ASSIGNED`. Choosing one here would make
 * two of the three wrong.
 */
export function fromProtoReason(
  value: ProtoReassignmentReason,
): ReassignmentReason | null {
  return DOMAIN_REASON[value] ?? null;
}

export function toAssignmentResponse(
  assignment: TicketAssignment,
): AssignmentResponse {
  return {
    id: assignment.id,
    ticketId: assignment.ticketId,
    assignedToId: assignment.assignedToId,
    assignedById: assignment.assignedById ?? undefined,
    departmentId: assignment.departmentId,
    assignedAt: toTimestamp(assignment.assignedAt),
    unassignedAt: toTimestamp(assignment.unassignedAt),
    reason: toProtoReason(assignment.reason),
    isCurrent: assignment.isCurrent,
    createdAt: toTimestamp(assignment.createdAt),
  };
}

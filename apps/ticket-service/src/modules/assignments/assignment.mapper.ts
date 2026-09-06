import {
  AssignmentResponse,
  toProtoReassignmentReason,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { TicketAssignment } from '../../generated/prisma/client';

// The reason bridge is NOT declared here. `libs/grpc-proto` already exports one
// built with `enumBridge`, whose forward map is exhaustive over the domain enum
// and whose reverse map is DERIVED — a local copy is a second table that can
// disagree with the wire, which is what a VarChar-to-numeric crossing must not
// have. Re-exported below because callers in this service import it from here.
export {
  fromProtoReassignmentReason,
  toProtoReassignmentReason,
} from '@synapsedesk/grpc-proto';

export function toAssignmentResponse(
  assignment: TicketAssignment,
): AssignmentResponse {
  return {
    id: assignment.id,
    ticketId: assignment.ticketId,
    assignedToId: assignment.assignedToId,
    assignedById: assignment.assignedById,
    departmentId: assignment.departmentId,
    assignedAt: toProtoTimestamp(assignment.assignedAt),
    unassignedAt: toProtoTimestamp(assignment.unassignedAt),
    reason: toProtoReassignmentReason(assignment.reason),
    isCurrent: assignment.isCurrent,
    createdAt: toProtoTimestamp(assignment.createdAt),
  };
}

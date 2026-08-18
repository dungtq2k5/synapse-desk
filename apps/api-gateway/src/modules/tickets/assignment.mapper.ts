import {
  AssignmentResponse,
  AssignTicketRequest,
  ListAssignmentsResponse,
  toProtoReassignmentReason,
  fromProtoReassignmentReason,
  fromProtoTimestamp,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AssignmentResponseDto } from './dto/rest/assignment-response.dto';
import { AssignTicketDto } from './dto/rest/assignment.dto';

/**
 * Converts an `AssignmentResponse` off the wire into its REST DTO.
 *
 * @throws Error if `assignedAt` or `createdAt` is missing, which the proto marks
 * non-optional.
 */
export function toAssignmentResponseDto(
  assignment: AssignmentResponse,
): AssignmentResponseDto {
  return {
    id: assignment.id,
    ticketId: assignment.ticketId,
    assignedToId: assignment.assignedToId,
    assignedById: assignment.assignedById ?? null,
    departmentId: assignment.departmentId,
    assignedAt: requireProtoTimestamp(assignment.assignedAt, 'assignedAt'),
    unassignedAt: fromProtoTimestamp(assignment.unassignedAt) ?? null,
    reason: fromProtoReassignmentReason(assignment.reason),
    isCurrent: assignment.isCurrent,
    createdAt: requireProtoTimestamp(assignment.createdAt, 'createdAt'),
  };
}

/** Builds an `AssignTicketRequest` from the REST body. */
export function toAssignTicketRequest(
  ticketId: string,
  dto: AssignTicketDto,
): AssignTicketRequest {
  return {
    ticketId,
    assigneeId: dto.assigneeId,
    departmentId: dto.departmentId,
    reason: toProtoReassignmentReason(dto.reason),
  };
}

/** Converts a `ListAssignmentsResponse` off the wire into its REST DTOs. */
export function toAssignmentResponseDtos(
  response: ListAssignmentsResponse,
): AssignmentResponseDto[] {
  return response.items.map(toAssignmentResponseDto);
}

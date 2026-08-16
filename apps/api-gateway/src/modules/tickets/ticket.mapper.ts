import {
  fromProtoTicketPriority,
  fromProtoTicketSource,
  fromProtoTicketStatus,
  fromProtoTimestamp,
  requireProtoTimestamp,
  TicketResponse,
} from '@synapsedesk/grpc-proto';
import { TicketResponseDto } from './dto/rest/ticket-response.dto';

/**
 * Converts a `TicketResponse` off the wire into its REST DTO.
 *
 * protobuf has no null, so every optional field arrives as `undefined` and is
 * converted to `null` here — the REST contract commits to a stable key set.
 * Enum fields go through the shared `fromProto*` bridges, which answer `null`
 * for both an unset and an unrecognized value.
 *
 * @throws Error if `createdAt` or `updatedAt` is missing, which the proto marks
 * non-optional.
 */
export function toTicketResponseDto(ticket: TicketResponse): TicketResponseDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    organizationId: ticket.organizationId,
    authorId: ticket.authorId,
    // `?? null` is no longer needed: `fromProto*` already answers null for
    // UNSPECIFIED and for UNRECOGNIZED, which is what the old `?? null` was
    // catching — except it could only catch the first, because a lookup miss
    // and a zero value were the same `undefined`.
    source: fromProtoTicketSource(ticket.source),
    status: fromProtoTicketStatus(ticket.status),
    priority: fromProtoTicketPriority(ticket.priority),
    title: ticket.title,
    description: ticket.description,
    currentAssigneeId: ticket.currentAssigneeId ?? null,
    currentDepartmentId: ticket.currentDepartmentId ?? null,
    escalatedAt: fromProtoTimestamp(ticket.escalatedAt) ?? null,
    resolvedAt: fromProtoTimestamp(ticket.resolvedAt) ?? null,
    // Non-optional in the proto, so a missing value is a contract violation
    // rather than something to paper over with a fallback date.
    createdAt: requireProtoTimestamp(ticket.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(ticket.updatedAt, 'updatedAt'),
    deletedAt: fromProtoTimestamp(ticket.deletedAt) ?? null,
    deletedById: ticket.deletedById ?? null,
  };
}

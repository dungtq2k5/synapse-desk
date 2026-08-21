import {
  TicketStatusChangeResponse,
  fromProtoTicketPriority,
  fromProtoTicketSource,
  fromProtoTicketStatus,
  fromProtoTimestamp,
  ListTicketsRequest,
  ListTicketsResponse,
  requireProtoTimestamp,
  TicketResponse,
  toPageRequest,
  toProtoTicketPriority,
  toProtoTicketSource,
  toProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { ListTicketsQueryDto } from './dto/rest/ticket.dto';
import {
  TicketResponseDto,
  TicketStatusChangeResponseDto,
} from './dto/rest/ticket-response.dto';

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

/** Builds a `ListTicketsRequest` from the REST query. */
export function toListTicketsRequest(
  query: ListTicketsQueryDto,
): ListTicketsRequest {
  return {
    page: toPageRequest(query),
    status: toProtoTicketStatus(query.status),
    priority: toProtoTicketPriority(query.priority),
    source: toProtoTicketSource(query.source),
    // `''` rather than `undefined`, and the proto field stays NON-optional on
    // purpose. For a FILTER, "absent" and "empty" mean the same thing -- no
    // filter -- so explicit presence would buy a distinction nothing uses while
    // obliging the service to accept both spellings of it.
    assigneeId: query.assigneeId ?? '',
    departmentId: query.departmentId ?? '',
    authorId: query.authorId ?? '',
    includeDeleted: query.includeDeleted,
  };
}

/** Converts a `ListTicketsResponse` into the paginated REST envelope. */
export function toTicketPageDto(
  response: ListTicketsResponse,
): PaginationResponseDto<TicketResponseDto> {
  return {
    items: response.items.map(toTicketResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * A status-history row on the way out.
 *
 * `fromStatus` is null on a row with no prior status — `fromProtoTicketStatus`
 * answers `null` for `UNSPECIFIED`, and that null is the honest rendering
 * rather than an omitted key the client has to guess about.
 */
export function toTicketStatusChangeResponseDto(
  row: TicketStatusChangeResponse,
): TicketStatusChangeResponseDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    fromStatus: fromProtoTicketStatus(row.fromStatus),
    toStatus: fromProtoTicketStatus(row.toStatus)!,
    changedById: row.changedById,
    reason: row.reason ?? null,
    changedAt: fromProtoTimestamp(row.changedAt)!,
  };
}

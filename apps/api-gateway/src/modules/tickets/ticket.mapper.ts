import {
  fromTimestamp,
  requireTimestamp,
  TicketPriority as ProtoTicketPriority,
  TicketResponse,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { TicketResponseDto } from './dto/rest/ticket-response.dto';

/**
 * Wire -> REST, the mirror of ticket-service's own mapper.
 *
 * protobuf has no null, so an unset field arrives as `undefined`. The REST
 * contract commits to `null` instead — a client (and an OpenAPI schema) sees a
 * stable key set rather than fields that vanish — so every optional field is
 * converted deliberately here rather than passed through.
 */

const STATUS_BY_PROTO: Record<number, TicketStatus> = {
  [ProtoTicketStatus.TICKET_STATUS_NEW]: TicketStatus.NEW,
  [ProtoTicketStatus.TICKET_STATUS_OPEN]: TicketStatus.OPEN,
  [ProtoTicketStatus.TICKET_STATUS_PENDING_AGENT]: TicketStatus.PENDING_AGENT,
  [ProtoTicketStatus.TICKET_STATUS_ESCALATED]: TicketStatus.ESCALATED,
  [ProtoTicketStatus.TICKET_STATUS_RESOLVED]: TicketStatus.RESOLVED,
  [ProtoTicketStatus.TICKET_STATUS_CLOSED]: TicketStatus.CLOSED,
};

const PROTO_BY_STATUS: Record<TicketStatus, ProtoTicketStatus> =
  Object.fromEntries(
    Object.entries(STATUS_BY_PROTO).map(([proto, domain]) => [
      domain,
      Number(proto),
    ]),
  ) as Record<TicketStatus, ProtoTicketStatus>;

const PRIORITY_BY_PROTO: Record<number, TicketPriority> = {
  [ProtoTicketPriority.TICKET_PRIORITY_LOW]: TicketPriority.LOW,
  [ProtoTicketPriority.TICKET_PRIORITY_MEDIUM]: TicketPriority.MEDIUM,
  [ProtoTicketPriority.TICKET_PRIORITY_HIGH]: TicketPriority.HIGH,
  [ProtoTicketPriority.TICKET_PRIORITY_URGENT]: TicketPriority.URGENT,
};

const PROTO_BY_PRIORITY: Record<TicketPriority, ProtoTicketPriority> =
  Object.fromEntries(
    Object.entries(PRIORITY_BY_PROTO).map(([proto, domain]) => [
      domain,
      Number(proto),
    ]),
  ) as Record<TicketPriority, ProtoTicketPriority>;

const SOURCE_BY_PROTO: Record<number, TicketSource> = {
  [ProtoTicketSource.TICKET_SOURCE_WEB]: TicketSource.WEB,
  [ProtoTicketSource.TICKET_SOURCE_CHAT]: TicketSource.CHAT,
  [ProtoTicketSource.TICKET_SOURCE_EMAIL]: TicketSource.EMAIL,
  [ProtoTicketSource.TICKET_SOURCE_API]: TicketSource.API,
};

const PROTO_BY_SOURCE: Record<TicketSource, ProtoTicketSource> =
  Object.fromEntries(
    Object.entries(SOURCE_BY_PROTO).map(([proto, domain]) => [
      domain,
      Number(proto),
    ]),
  ) as Record<TicketSource, ProtoTicketSource>;

/**
 * REST -> wire. `undefined` becomes the proto zero value, which every list RPC
 * reads as "no filter" and every write RPC reads as "use the default".
 */
export function toProtoStatus(value?: TicketStatus): ProtoTicketStatus {
  return value
    ? PROTO_BY_STATUS[value]
    : ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED;
}

export function toProtoPriority(value?: TicketPriority): ProtoTicketPriority {
  return value
    ? PROTO_BY_PRIORITY[value]
    : ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED;
}

export function toProtoSource(value?: TicketSource): ProtoTicketSource {
  return value
    ? PROTO_BY_SOURCE[value]
    : ProtoTicketSource.TICKET_SOURCE_UNSPECIFIED;
}

export function toTicketDto(ticket: TicketResponse): TicketResponseDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    organizationId: ticket.organizationId,
    authorId: ticket.authorId,
    source: SOURCE_BY_PROTO[ticket.source] ?? null,
    status: STATUS_BY_PROTO[ticket.status] ?? null,
    priority: PRIORITY_BY_PROTO[ticket.priority] ?? null,
    title: ticket.title,
    description: ticket.description,
    currentAssigneeId: ticket.currentAssigneeId ?? null,
    currentDepartmentId: ticket.currentDepartmentId ?? null,
    escalatedAt: fromTimestamp(ticket.escalatedAt) ?? null,
    resolvedAt: fromTimestamp(ticket.resolvedAt) ?? null,
    // Non-optional in the proto, so a missing value is a contract violation
    // rather than something to paper over with a fallback date.
    createdAt: requireTimestamp(ticket.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(ticket.updatedAt, 'updatedAt'),
    deletedAt: fromTimestamp(ticket.deletedAt) ?? null,
    deletedById: ticket.deletedById ?? null,
  };
}

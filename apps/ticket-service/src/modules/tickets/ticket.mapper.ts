import {
  TicketPriority as ProtoTicketPriority,
  TicketResponse,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { Ticket } from '../../generated/prisma/client';

/**
 * Prisma row -> wire, and the enum bridges either way.
 *
 * The columns are VarChar and the proto fields are numeric enums, so every
 * crossing needs an explicit map. These are the only sanctioned bridges — the
 * same discipline `fromProtoGender` follows in the shared mappers, and for the
 * same reason: a bare cast compiles and produces a value the other side reads
 * as something the sender never wrote.
 */

const PROTO_STATUS: Record<TicketStatus, ProtoTicketStatus> = {
  [TicketStatus.NEW]: ProtoTicketStatus.TICKET_STATUS_NEW,
  [TicketStatus.OPEN]: ProtoTicketStatus.TICKET_STATUS_OPEN,
  [TicketStatus.PENDING_AGENT]: ProtoTicketStatus.TICKET_STATUS_PENDING_AGENT,
  [TicketStatus.ESCALATED]: ProtoTicketStatus.TICKET_STATUS_ESCALATED,
  [TicketStatus.RESOLVED]: ProtoTicketStatus.TICKET_STATUS_RESOLVED,
  [TicketStatus.CLOSED]: ProtoTicketStatus.TICKET_STATUS_CLOSED,
};

const DOMAIN_STATUS: Record<number, TicketStatus> = Object.fromEntries(
  Object.entries(PROTO_STATUS).map(([domain, proto]) => [proto, domain]),
) as Record<number, TicketStatus>;

const PROTO_PRIORITY: Record<TicketPriority, ProtoTicketPriority> = {
  [TicketPriority.LOW]: ProtoTicketPriority.TICKET_PRIORITY_LOW,
  [TicketPriority.MEDIUM]: ProtoTicketPriority.TICKET_PRIORITY_MEDIUM,
  [TicketPriority.HIGH]: ProtoTicketPriority.TICKET_PRIORITY_HIGH,
  [TicketPriority.URGENT]: ProtoTicketPriority.TICKET_PRIORITY_URGENT,
};

const DOMAIN_PRIORITY: Record<number, TicketPriority> = Object.fromEntries(
  Object.entries(PROTO_PRIORITY).map(([domain, proto]) => [proto, domain]),
) as Record<number, TicketPriority>;

const PROTO_SOURCE: Record<TicketSource, ProtoTicketSource> = {
  [TicketSource.WEB]: ProtoTicketSource.TICKET_SOURCE_WEB,
  [TicketSource.CHAT]: ProtoTicketSource.TICKET_SOURCE_CHAT,
  [TicketSource.EMAIL]: ProtoTicketSource.TICKET_SOURCE_EMAIL,
  [TicketSource.API]: ProtoTicketSource.TICKET_SOURCE_API,
};

const DOMAIN_SOURCE: Record<number, TicketSource> = Object.fromEntries(
  Object.entries(PROTO_SOURCE).map(([domain, proto]) => [proto, domain]),
) as Record<number, TicketSource>;

export function toProtoTicketStatus(value: string): ProtoTicketStatus {
  return (
    PROTO_STATUS[value as TicketStatus] ??
    ProtoTicketStatus.TICKET_STATUS_UNSPECIFIED
  );
}

/**
 * Returns null for UNSPECIFIED and for anything unrecognised.
 *
 * Null rather than a default, because UNSPECIFIED means "the caller omitted
 * this field" — and on a LIST request that means "no filter", while on a status
 * CHANGE it means the request is incomplete. Only the caller knows which, so
 * the decision is left to it rather than guessed here.
 */
export function fromProtoTicketStatus(
  value: ProtoTicketStatus,
): TicketStatus | null {
  return DOMAIN_STATUS[value] ?? null;
}

export function toProtoTicketPriority(value: string): ProtoTicketPriority {
  return (
    PROTO_PRIORITY[value as TicketPriority] ??
    ProtoTicketPriority.TICKET_PRIORITY_UNSPECIFIED
  );
}

export function fromProtoTicketPriority(
  value: ProtoTicketPriority,
): TicketPriority | null {
  return DOMAIN_PRIORITY[value] ?? null;
}

export function toProtoTicketSource(value: string): ProtoTicketSource {
  return (
    PROTO_SOURCE[value as TicketSource] ??
    ProtoTicketSource.TICKET_SOURCE_UNSPECIFIED
  );
}

export function fromProtoTicketSource(
  value: ProtoTicketSource,
): TicketSource | null {
  return DOMAIN_SOURCE[value] ?? null;
}

export function toTicketResponse(ticket: Ticket): TicketResponse {
  return {
    id: ticket.id,
    // BigInt -> number. `longs: Number` in GRPC_LOADER_OPTIONS makes int64 a
    // plain JS number on both ends, which is exact to 2^53 — nine quadrillion
    // tickets is not a limit worth engineering around.
    ticketNumber: Number(ticket.ticketNumber),
    organizationId: ticket.organizationId,
    authorId: ticket.authorId,
    source: toProtoTicketSource(ticket.source),
    status: toProtoTicketStatus(ticket.status),
    priority: toProtoTicketPriority(ticket.priority),
    title: ticket.title,
    description: ticket.description,
    currentAssigneeId: ticket.currentAssigneeId ?? undefined,
    currentDepartmentId: ticket.currentDepartmentId ?? undefined,
    escalatedAt: toProtoTimestamp(ticket.escalatedAt),
    resolvedAt: toProtoTimestamp(ticket.resolvedAt),
    createdAt: toProtoTimestamp(ticket.createdAt),
    updatedAt: toProtoTimestamp(ticket.updatedAt),
    deletedAt: toProtoTimestamp(ticket.deletedAt),
    deletedById: ticket.deletedById ?? undefined,
  };
}

/** @file Prisma row -> wire for a ticket. */

import {
  TicketStatusChangeResponse,
  TicketResponse,
  toProtoTicketPriority,
  toProtoTicketSource,
  toProtoTicketStatus,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { Ticket, TicketStatusChange } from '../../generated/prisma/client';

// The enum bridges are NOT declared here. `libs/grpc-proto` already exports one
// per enum, built with `enumBridge`: the forward map is exhaustive over the
// domain enum, so a new member fails to compile, and the reverse map is DERIVED
// rather than hand-written. A local copy is a second table that can disagree
// with the wire — which is exactly the failure a VarChar-to-numeric crossing
// produces silently. Re-exported because this service's callers import them here.
export {
  fromProtoTicketPriority,
  fromProtoTicketSource,
  fromProtoTicketStatus,
  toProtoTicketPriority,
  toProtoTicketSource,
  toProtoTicketStatus,
} from '@synapsedesk/grpc-proto';

/**
 * @param unreadCount Messages the caller has not read. Defaults to 0 — every
 *   single-ticket read passes nothing, because a badge is a LIST affordance and
 *   a caller looking at one ticket is reading it.
 */
export function toTicketResponse(
  ticket: Ticket,
  unreadCount: number = 0,
): TicketResponse {
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
    unreadCount,
    createdAt: toProtoTimestamp(ticket.createdAt),
    updatedAt: toProtoTimestamp(ticket.updatedAt),
    deletedAt: toProtoTimestamp(ticket.deletedAt),
    deletedById: ticket.deletedById ?? undefined,
  };
}

/**
 * A `ticket_status_changes` row on the wire.
 *
 * `fromStatus` maps through `toProtoTicketStatus` like every other status, so a
 * NULL — a row with no prior status — arrives as `UNSPECIFIED` rather than as
 * an absent field the reader must special-case.
 */
export function toTicketStatusChangeResponse(
  row: TicketStatusChange,
): TicketStatusChangeResponse {
  return {
    id: row.id,
    ticketId: row.ticketId,
    fromStatus: toProtoTicketStatus(row.fromStatus),
    toStatus: toProtoTicketStatus(row.toStatus),
    changedById: row.changedById,
    reason: row.reason ?? undefined,
    changedAt: toProtoTimestamp(row.changedAt),
  };
}

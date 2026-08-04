import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  canTransition,
  TICKET_STATUS_TRANSITIONS,
  TicketStatus,
} from '@synapsedesk/common';

/**
 * THE transition check. One function, one table, every entry point.
 *
 * `changeStatus`, `escalate`, `resolve`, `reopen` and `close` all call this —
 * that is the whole point of it existing. If each convenience RPC carried its
 * own idea of what it may transition from, `POST /tickets/:id/resolve` and
 * `POST /tickets/:id/status {status: RESOLVED}` would diverge the first time
 * one was updated and the other was not, and the divergence would be invisible
 * until a customer hit the path nobody exercised.
 *
 * ABORTED, which the gateway maps to 409 — not FAILED_PRECONDITION, which maps
 * to 400. This is a conflict with the ticket's CURRENT state and is retryable
 * once it moves; 400 would tell a client its request was malformed, which it
 * was not.
 *
 * The message names the legal targets so a caller can act on the error alone.
 */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (canTransition(from, to)) return;

  const legal = TICKET_STATUS_TRANSITIONS[from] ?? [];

  throw new RpcException({
    code: status.ABORTED,
    message:
      `Cannot move a ticket from ${from} to ${to}. ` +
      `Legal from ${from}: ${legal.join(', ') || 'none'}.`,
  });
}

/**
 * Whether a stored string is a status this build knows.
 *
 * `tickets.status` is a VarChar, not a Postgres enum (conventions §7.3), so
 * nothing in the database stops a bad value — a migration, a backfill or a psql
 * session all bypass the application. Reading one back and feeding it to the
 * transition table would look up `undefined` and silently permit everything.
 */
export function assertKnownStatus(value: string): TicketStatus {
  if (!Object.values(TicketStatus).includes(value as TicketStatus)) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `'${value}' is not a valid ticket status`,
    });
  }

  return value as TicketStatus;
}

/**
 * The side effects a transition carries, derived from the target status.
 *
 * Derived rather than passed in by each caller: `resolvedAt` must be set when a
 * ticket resolves and cleared when it reopens, and a caller that set one and
 * forgot the other would leave a reopened ticket claiming a resolution date.
 * Returning them together is what makes that impossible to get half-right.
 */
export function transitionSideEffects(to: TicketStatus): {
  resolvedAt?: Date | null;
  escalatedAt?: Date | null;
} {
  switch (to) {
    case TicketStatus.RESOLVED:
      return { resolvedAt: new Date() };

    case TicketStatus.ESCALATED:
      return { escalatedAt: new Date() };

    case TicketStatus.OPEN:
      // Reopening. `resolvedAt` is cleared because it is no longer true, and
      // leaving it set would make every "time to resolution" metric count a
      // ticket that is open again. `escalatedAt` is deliberately KEPT: the
      // ticket really was escalated once, and that is history rather than
      // current state.
      return { resolvedAt: null };

    default:
      return {};
  }
}

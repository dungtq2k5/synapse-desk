# 0040 — A ticket's status history is a table, not an audit trail

**Status:** accepted · **Code:** `apps/ticket-service/prisma/schema.prisma` (`TicketStatusChange`), `tickets.service.ts` (`transition`)

## Decision

`GET /tickets/:id/history` reads `ticket_status_changes`, written inside the same transaction as the status update. It does **not** read `audit_logs`, and it does not consume `ticket.status_changed`.

It is a **status** history. Reassignments keep their own at `GET /tickets/:id/assignments`.

## Why

Three sources could have served it, and two lose for the same reason.

- **`audit_logs`** — `AuditAction` has no `TICKET_*` member and `AuditResourceType` has no `TICKET`, so `listAuditLogs` cannot express the query at all. Adding both is cheap; what is not cheap is that the trail is **at-most-once by design**. `AuditPublisher` accepts holes when the broker is down, and `AuditConsumer` catches, logs and drops rather than risking a poison-message loop.
- **`ticket.status_changed`** — already on the wire carrying `fromStatus`, `toStatus` and `changedById`, and `ticket.contract.ts` says the payloads are deliberately fat *"FOR consumers that do not exist yet"*. A history consumer is the anticipated shape and cheaper than adding two enums. But `TicketEventPublisher` is *"fire-and-forget, exactly like `AuditPublisher`"*, so it has the same holes.

**A holed admin trail is a documented trade. A holed ticket history is a screen that silently omits what happened to a customer's ticket, read by the person it happened to.** That is the whole decision.

The permission boundary settles it independently: `GET /audit-logs` is an admin permission, and this route is readable by anyone who can read the ticket. Serving it from `audit_logs` would mean widening who can read that table, or building a second narrower path over it. A `ticket_status_changes` row is ticket data by construction, scoped by the same visibility filter as the ticket.

The system had already made this call once — `ticket_assignments` is a dedicated table rather than an audit row, for the other half of the same history.

## Consequences

- **The four convenience RPCs gained a reason.** `EscalateTicket`, `ResolveTicket`, `ReopenTicket` and `CloseTicket` moved from `TicketIdRequest` to `TicketStatusActionRequest`. Before this they took none, and doc 47 §0 had just forbidden the one route that did (`POST /:id/status`) from reaching `RESOLVED` and `CLOSED` — so the two transitions a history is most read to explain were the two that could never carry an explanation. `DeleteTicket` and `RestoreTicket` keep `TicketIdRequest`: deletion provenance is a different question.
- **`MAX_STATUS_CHANGE_REASON_LENGTH` moved to `libs/common`.** Both edges bound it — the DTO for a 400 naming the field, ticket-service because it is reachable over gRPC where no `ValidationPipe` ran — and two copies of the number would be two places for it to drift.
- **`reason` is free text, unlike `ticket_assignments.reason`.** That one is a closed `ReassignmentReason` enum answering "which of six"; this answers "what happened", which no enum this system could write would cover. It is therefore tenant prose, and stays out of audit rows.
- **`changed_by_id` is NOT NULL.** `transition` loads through `tenantScope`, which refuses a caller with no `sub`, so no transition can happen without an actor. A future system-driven transition — an auto-close sweep — would enter elsewhere and should revisit the column then, rather than it being nullable now to describe a state nothing can produce.
- **`TICKET_*` audit actions are still worth having**, for the platform trail. They answer "what did this actor do", read during an incident; this answers "what happened to this ticket", read by its owner. Doc 44 §4 drew the same line for exports.
- **The event stays.** notification-service consumes it, and it is a notification rather than a record. The row is authoritative.

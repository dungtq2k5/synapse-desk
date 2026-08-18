# 0019 — Notification grouping is scoped to unread

**Status:** accepted · **Code:** `apps/notification-service/`, `notifications.group_key`

## Decision

The group-collapse index is partial: `WHERE read_at IS NULL AND group_key IS NOT NULL`.

## Why

- **Once a user has read "3 new replies", the next reply is new information** and starts a fresh row. Without the unread scope a long thread produces one notification the user read on day one and never sees again.

## Consequences

- **Grouping and `event_id` idempotency pull in opposite directions.** The insert is deduped by `UNIQUE (recipient_id, event_id)`, but an *increment* has no such protection, so a NATS redelivery can double-count. Store the triggering `event_id` on the row and skip the increment when it matches the last one.
- `notifications.event_id` is **derived, not generated**: the same threshold crossing produces the same id, so redelivery is a duplicate-key violation rather than a second email.
- Preference resolution order is exact `(type, channel)` → `('*', channel)` → hard-coded default. The API returns the **resolved** value plus whether it came from an explicit row, so the UI can show "inherited" rather than pretending every value was chosen.
- `TicketDomainEvent` was built as a discriminated union carrying `groupKey` deliberately, so Domain E needed no producer changes in Domain B.

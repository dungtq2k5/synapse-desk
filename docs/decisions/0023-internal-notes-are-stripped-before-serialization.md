# 0023 — Internal notes are stripped at read time, before serialization

**Status:** accepted · **Code:** `apps/ticket-service/`, `apps/api-gateway/src/modules/realtime/`

## Decision

`is_internal_note` is a **read-time filter**, not a write-time restriction. Rows are removed before serialization — never fetched then filtered at the gateway.

## Why

- An agent may legitimately post an internal note; the restriction is on who can *see* it.
- **Fetch-then-filter leaks the note's existence** through response shape, pagination totals and timing, even when the body is removed.

## Consequences

- The same split governs `message:new`, `message:updated` and `message:deleted`. Build it once, before three events inherit the bug instead of one.
- The gateway's transcript filter is a different mechanism from the services', and that difference is the wrong precedent to copy.

# 0011 — WebSocket is a transport, not a second write path

**Status:** accepted · **Code:** `apps/api-gateway/src/modules/realtime/`

## Decision

`message:send` delegates to the same service call the HTTP route uses. It does not reimplement the write.

## Why

- **"Mirrors `POST /tickets/:id/messages`" is the trap.** A second implementation of a write means two validators, two audit call sites, two notification triggers, two rate limits — and they diverge on the first change to either.

## Consequences

- The gateway builds `CallerContext` from the socket rather than from a request, and acknowledges to the sender via the Socket.IO ack so the client can clear pending state.
- It **does not** emit `message:new` itself. The NATS consumer already does that for the HTTP path; emitting here too double-delivers to every socket in the room.
- **`canRead` is not `canWrite`.** Two named methods, not a boolean parameter — a flag invites a call site to pass the wrong one and get a plausible answer. Both fail closed: an unreachable peer denies.
- **WS clients retry in a way HTTP clients do not.** A client-generated `clientMessageId` is required, deduped on `(ticket_id, client_message_id)` via a partial unique index. A duplicate returns the *original* message id in the ack rather than an error — the client's intent was satisfied, and an error would make it retry again.
- Typing indicators emit with `client.to(room)` (excluding the sender) and are throttled server-side to ~1 frame per 2s. Relaying per keystroke is a broadcast storm on a busy thread.

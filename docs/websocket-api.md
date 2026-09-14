# WebSocket API — a reference for the front end

Real-time in SynapseDesk is one Socket.IO namespace on the API gateway. This document is the contract: what to connect to, what you are subscribed to without asking, what you may send, what arrives, and the handful of behaviours that will cost you an afternoon if you assume the obvious thing.

Everything here is generated from the gateway's own declarations — `realtime.config.ts` holds the event names and limits, `realtime.gateway.ts` holds the handshake. **If this document and those files disagree, they are right and this is stale**; please report it.

---

## 1. Connecting

```ts
import { io } from 'socket.io-client';

const socket = io(`${API_ORIGIN}/ws`, {
  withCredentials: true,        // required — see §2
  transports: ['websocket'],
});
```

- **Namespace: `/ws`.** Not the default namespace.
- **`withCredentials: true` is mandatory.** Without it the browser sends no cookie and the handshake is refused.
- **`transports: ['websocket']` is mandatory too**, and it is a *deployment* constraint rather than a preference. Socket.IO's default list begins with HTTP long-polling, whose handshake is a sequence of requests that must all reach the **same** gateway replica; the Redis adapter shares broadcasts across replicas, not handshake state. With more than one replica a polling client gets `Session ID unknown` and reconnect-loops. Pin it, in every client.
- The gateway's global prefix does **not** apply to the socket path.

### CORS

The handshake is an ordinary cross-origin request and is subject to the same origin rules as the REST API. The server allows the origins in its `CORS` setting; a rejected handshake surfaces as a connect error naming the origin.

---

## 2. Authentication — the access-token cookie

The socket authenticates with the **same `HttpOnly` access-token cookie the REST API uses**. There is no separate socket token, no `auth` payload, and no query parameter.

- **Web:** log in over REST first, then connect. `withCredentials: true` is what attaches the cookie.
- **React Native:** the socket client has no browser cookie jar. You must carry the cookie yourself:

  ```ts
  const socket = io(`${API_ORIGIN}/ws`, {
    transports: ['websocket'],
    extraHeaders: { Cookie: `${ACCESS_COOKIE_NAME}=${accessToken}` },
  });
  ```

  This is the single most common reason a mobile client connects on web and is refused on device.

**A half-authenticated session is refused.** A two-factor *challenge* token proves a password and nothing more; presenting one is rejected with `Two-factor challenge is not complete`.

**Refusal is a hard disconnect.** An unauthenticated socket is not left open to retry — it is closed. Reconnect after re-authenticating over REST, not by re-emitting.

---

## 3. `connection:ready` — wait for it before you emit

Socket.IO fires the client-side `connect` event as soon as the transport is up, which is **before** the server has verified your token and joined your rooms.

```ts
socket.on('connection:ready', ({ data }) => {
  // data: { userId, organizationId }
  // Only now may you emit anything.
});
```

**A client that emits `ticket:join` on `connect` races the server** and is told it is unauthorized — intermittently, and not reproducibly on a fast machine. Gate every emit on `connection:ready`, and re-gate after every reconnect.

### There are two frame shapes, and the destructuring above works for only one

| Kind | Shape | Examples |
| :--- | :--- | :--- |
| **Constructed** by the gateway | enveloped — `{ data: … }` | `connection:ready`, and the frames the gateway builds itself |
| **Relayed** from a domain event | **bare** — the event object itself | `notification:new`, `ticket:updated`, `message:new` |

**Do not copy `({ data }) =>` onto a relayed event.** For most of them you get `undefined` and notice immediately. For **`notification:new` you do not**: `NotificationRealtimePayload` has its own field called `data` (`Record<string, unknown>`, the notification's payload blob), so the destructuring succeeds and hands you the wrong object. Nothing throws and nothing looks empty.

```ts
socket.on('notification:new', (payload) => {
  payload.notificationId;   // ✓ the frame IS the payload
  payload.data;             // the notification's own blob — not an envelope
});
```

Check each event in §6 before destructuring.

---

## 4. Rooms — you do not join most of them

The server puts every authenticated socket into its identity rooms at connection, from the verified token. You cannot request them and you do not need to.

| Room | Joined | Carries |
| :--- | :--- | :--- |
| `user:{yourId}` | automatically | notifications, ticket assignments, your document events |
| `org:{tenantId}` | automatically | tenant-wide ticket and presence events |
| `dept:{id}` (one per department you belong to) | automatically | `document:indexed` for department-scoped documents |
| `ticket:{id}` | **you join** via `ticket:join` | the thread's messages and typing |
| `ticket:{id}:internal` | joined *with* `ticket:join`, only if you hold `ticket.read.all` | internal notes |

**Internal notes are a separate room, not a filtered field.** If you are not an agent you never receive them at all — there is nothing to hide client-side. Permission is evaluated **at join time**, so a permission revoked mid-session takes effect on the next join rather than immediately.

---

## 5. Client → server events

Every one of these is rate-limited per socket. Exceeding a limit is a refusal, not a disconnect.

| Event | Payload | Ack | Limit (per minute) |
| :--- | :--- | :--- | :--- |
| `ticket:join` | `{ ticketId }` | **no** — wait for `ticket:joined` | 60 |
| `ticket:leave` | `{ ticketId }` | **no** | 120 |
| `message:send` | the message body | **yes — always read it** | 30 |
| `typing:start` | `{ ticketId }` | no | 240 |
| `typing:stop` | `{ ticketId }` | no | 240 |
| `presence:update` | `{ state }` — `online \| away \| busy \| offline` | yes | 120 |
| `ai:stream:cancel` | `{ streamId }` | yes | 60 |

**Exactly three events acknowledge**: `message:send`, `presence:update` and `ai:stream:cancel`. `emitWithAck` on any of the others waits for a callback the server never invokes — the same trap this section warns about for `message:send`, in the opposite direction. Confirm a join by listening for `ticket:joined` (§6).

**`presence:update` takes `state`, not `status`.** The payload is validated with `forbidNonWhitelisted`, so `{ status: 'away' }` is refused twice over — an unknown property *and* a missing required one.

`message:send` reaches the same service as `POST /tickets/:id/messages` and is metered to match it. **Read its ack**: a refusal arrives there, and a client that only listens for an `exception` frame will leave its spinner running forever.

**The ack also carries `skippedAttachments`, and it is a different skip channel from the one in §6.** The ack's list is files that were never attached; the event's is files the model could not read. A client that surfaces only one of them tells the user half of what happened.

### Ack envelope

Acks use the same envelope as the REST API, so one parser covers both:

```ts
// success
{ success: true, message: string, warning?: string, data: T }

// failure — identical in shape to a REST error response
{ success: false, ... }
```

---

## 6. Server → client events

Named from your point of view, and deliberately **coarser than the server's own domain events**: a ticket re-renders the same way whether it was assigned, reassigned or had its status changed. The full domain event travels in the payload, so read `payload.pattern` when you need the distinction.

### Tickets and messages

| Event | Room | Notes |
| :--- | :--- | :--- |
| `ticket:created` | `org:` | |
| `ticket:updated` | `ticket:` **always**; `org:` **only on escalation**; `user:` on assign/reassign | see the warning below |
| `ticket:assigned` | `user:` | *personal* — a call to action, not a state change |
| `ticket:joined` | your socket only | confirms a `ticket:join` |
| `message:new` | `ticket:` | |
| `message:updated` | `ticket:` or `:internal` | an edit |
| `message:deleted` | `ticket:` or `:internal` | **carries no content** — a redaction announces only that it happened, plus the id |
| `typing` | `ticket:`, minus the sender | see §7 |

**`ticket:updated` does not reach the org room on most changes.** Measured across the five producing patterns: the ticket room gets all five, the org room gets **one** — escalation. So a queue dashboard built on `org:` alone will not refresh on a status change, an assignment or an unassignment, but *will* refresh on an escalation. Partial freshness reads as a flaky server, and it is not. **Build a queue view on a REST poll or on `ticket:created` plus your own refetch**, not on `ticket:updated` in the org room.

### AI streaming

| Event | Room | Notes |
| :--- | :--- | :--- |
| `ai:stream:chunk` | requesting socket | one token |
| `ai:stream:done` | requesting socket | final text, citations, message id, `status`. **The citations are also stored on the message** — `GET /chat/conversations/:id/messages` and `TicketMessage.citations` return the same five-field shape, so the frame's copy can be dropped once the list refreshes |
| `ai:stream:error` | requesting socket | |
| `ai:stream:attachments-skipped` | requesting socket | file **names** of attachments not sent to the model. Fires **before** the answer, so show it while the user is still reading |

`ai:stream:done` and `message:new` both arrive for one answer, and that is not duplication — *"your stream finished, here is the id"* versus *"a message appeared in this thread"*. Reconcile on the message id.

**Citations on the frame are the mapped shape, not the raw one.** Each is `{ chunkId, documentId, documentTitle, pageNumber, vectorPointId }`, and a citation without a page number carries **`pageNumber: null`** — the key is always present. The same five fields come back on the stored message, so a client can swap the frame's list for the persisted one field for field. On the cap path (`escalated: true`, `messageId: null`) the list is `[]` and nothing is stored, because nothing was answered.

`status` on `ai:stream:done` may be a value this build does not recognise, in which case it is the literal `UNSPECIFIED`. Write a default arm.

### Notifications

| Event | Room | Notes |
| :--- | :--- | :--- |
| `notification:new` | `user:` | the whole row — render and deep-link without a fetch |
| `notification:updated` | `user:` | an existing notification **coalesced** — same group, higher count. Update the toast you are already showing rather than stacking a twelfth |
| `notification:read` | `user:` | read or archived **on another device** |
| `notification:unread-count` | `user:` | the authoritative total, pushed on every change |

**Do not increment a local unread counter.** It is always wrong eventually, because a notification can be read on another device. Take `notification:unread-count` as the truth and stop polling `GET /notifications/unread-count`.

### Documents and presence

| Event | Room | Notes |
| :--- | :--- | :--- |
| `document:indexed` | uploader, plus `dept:` or `org:` | |
| `document:failed` | uploader **only** — a failure is not department news | |
| `presence` | `org:` | a colleague's availability changed |

---

## 7. Typing — the client expires it

`typing` frames carry a TTL of **5 seconds** and **you** must expire them.
`typing:stop` is a hint that a closed tab, a dead battery and a lost network all skip; a client that waits for one shows *"Alice is typing…"* forever.

Emit `typing:start` as often as you like — the server relays at most one frame per socket per ticket every 2 seconds and drops the rest silently. A dropped typing frame is invisible and correct.

---

## 8. Reconnection

Socket.IO reconnects on its own. Your responsibilities on each reconnect:

1. **Wait for `connection:ready` again** before emitting.
2. **Re-join every ticket room.** Room membership does not survive a reconnection — the server has a new socket and no memory of what the old one was watching.
3. **Refetch what you missed.** The socket is a *delivery optimisation, not a channel of record*: every event here has a REST equivalent, and rows are always written before the frame is emitted. After a gap, re-read the feed and the thread rather than assuming continuity.

   **Not everything has a REST equivalent.** `typing`, `presence:*` and the AI stream chunks are socket-only — there is no presence or typing controller in the gateway. Those are ephemeral by design: after a gap there is nothing to refetch and nothing was lost that matters. Everything durable — tickets, messages, notifications, documents — does have a REST read.
4. **Re-authenticate first if the cookie expired.** A refused handshake is a hard disconnect; reconnect attempts against an expired cookie will keep failing until you refresh the session over REST.

---

## 9. Things that will bite

- **Emitting before `connection:ready`** (§3). The most common integration bug, and it looks like a flaky server.
- **Missing cookie on React Native** (§2). Works on web, refused on device.
- **Treating the socket as the source of truth.** It is not; the database is. Anything you must not lose has a REST read.
- **Assuming rooms survive reconnects** (§8).
- **Stacking notification toasts** instead of handling `notification:updated` (§6). Grouping exists server-side and is invisible if you ignore it.
- **Ignoring the `message:send` ack** (§5). A refusal you never read is a message the user believes was sent.
- **Awaiting an ack from `ticket:join`** (§5). Three events acknowledge; that is not one of them, and `emitWithAck` will wait forever.
- **Destructuring `({ data })` off a relayed event** (§3). On `notification:new` this returns the notification's own `data` blob rather than failing — the one case where the wrong shape yields a plausible value.
- **Sending `{ status }` to `presence:update`** (§5). The field is `state`, and `forbidNonWhitelisted` refuses the frame rather than ignoring the extra key.
- **Reconciling an AI stream on `messageId`** (§6). It is null on the cap path, where `escalated: true` and **no `message:new` follows** — so the reconciliation fails in exactly the case it exists for. Branch on `escalated` first.
- **Waiting for `typing:stop`** (§7).

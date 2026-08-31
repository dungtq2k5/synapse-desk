# WebSocket API — a reference for the front end

Real-time in SynapseDesk is one Socket.IO namespace on the API gateway. This
document is the contract: what to connect to, what you are subscribed to without
asking, what you may send, what arrives, and the handful of behaviours that will
cost you an afternoon if you assume the obvious thing.

Everything here is generated from the gateway's own declarations —
`realtime.config.ts` holds the event names and limits, `realtime.gateway.ts`
holds the handshake. **If this document and those files disagree, they are
right and this is stale**; please report it.

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
- **`withCredentials: true` is mandatory.** Without it the browser sends no
  cookie and the handshake is refused.
- The gateway's global prefix does **not** apply to the socket path.

### CORS

The handshake is an ordinary cross-origin request and is subject to the same
origin rules as the REST API. The server allows the origins in its `CORS`
setting; a rejected handshake surfaces as a connect error naming the origin.

---

## 2. Authentication — the access-token cookie

The socket authenticates with the **same `HttpOnly` access-token cookie the REST
API uses**. There is no separate socket token, no `auth` payload, and no query
parameter.

- **Web:** log in over REST first, then connect. `withCredentials: true` is what
  attaches the cookie.
- **React Native:** the socket client has no browser cookie jar. You must carry
  the cookie yourself:

  ```ts
  const socket = io(`${API_ORIGIN}/ws`, {
    transports: ['websocket'],
    extraHeaders: { Cookie: `${ACCESS_COOKIE_NAME}=${accessToken}` },
  });
  ```

  This is the single most common reason a mobile client connects on web and is
  refused on device.

**A half-authenticated session is refused.** A two-factor *challenge* token
proves a password and nothing more; presenting one is rejected with
`Two-factor challenge is not complete`.

**Refusal is a hard disconnect.** An unauthenticated socket is not left open to
retry — it is closed. Reconnect after re-authenticating over REST, not by
re-emitting.

---

## 3. `connection:ready` — wait for it before you emit

Socket.IO fires the client-side `connect` event as soon as the transport is up,
which is **before** the server has verified your token and joined your rooms.

```ts
socket.on('connection:ready', ({ data }) => {
  // data: { userId, organizationId }
  // Only now may you emit anything.
});
```

**A client that emits `ticket:join` on `connect` races the server** and is told
it is unauthorized — intermittently, and not reproducibly on a fast machine.
Gate every emit on `connection:ready`, and re-gate after every reconnect.

---

## 4. Rooms — you do not join most of them

The server puts every authenticated socket into its identity rooms at
connection, from the verified token. You cannot request them and you do not need
to.

| Room | Joined | Carries |
| :--- | :--- | :--- |
| `user:{yourId}` | automatically | notifications, ticket assignments, your document events |
| `org:{tenantId}` | automatically | tenant-wide ticket and presence events |
| `dept:{id}` (one per department you belong to) | automatically | `document:indexed` for department-scoped documents |
| `ticket:{id}` | **you join** via `ticket:join` | the thread's messages and typing |
| `ticket:{id}:internal` | joined *with* `ticket:join`, only if you hold `ticket.read.all` | internal notes |

**Internal notes are a separate room, not a filtered field.** If you are not an
agent you never receive them at all — there is nothing to hide client-side.
Permission is evaluated **at join time**, so a permission revoked mid-session
takes effect on the next join rather than immediately.

---

## 5. Client → server events

Every one of these is rate-limited per socket. Exceeding a limit is a refusal,
not a disconnect.

| Event | Payload | Ack | Limit (per minute) |
| :--- | :--- | :--- | :--- |
| `ticket:join` | `{ ticketId }` | yes | 60 |
| `ticket:leave` | `{ ticketId }` | yes | 120 |
| `message:send` | the message body | **yes — always read it** | 30 |
| `typing:start` | `{ ticketId }` | no | 240 |
| `typing:stop` | `{ ticketId }` | no | 240 |
| `presence:update` | `{ status }` — `online \| away \| busy \| offline` | yes | 120 |
| `ai:stream:cancel` | `{ streamId }` | yes | 60 |

`message:send` reaches the same service as `POST /tickets/:id/messages` and is
metered to match it. **Read its ack**: a refusal arrives there, and a client that
only listens for an `exception` frame will leave its spinner running forever.

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

Named from your point of view, and deliberately **coarser than the server's own
domain events**: a ticket re-renders the same way whether it was assigned,
reassigned or had its status changed. The full domain event travels in the
payload, so read `payload.pattern` when you need the distinction.

### Tickets and messages

| Event | Room | Notes |
| :--- | :--- | :--- |
| `ticket:created` | `org:` | |
| `ticket:updated` | `ticket:`, `org:` | any change to the ticket's own fields |
| `ticket:assigned` | `user:` | *personal* — a call to action, not a state change |
| `ticket:joined` | your socket only | confirms a `ticket:join` |
| `message:new` | `ticket:` | |
| `message:updated` | `ticket:` or `:internal` | an edit |
| `message:deleted` | `ticket:` or `:internal` | **carries no content** — a redaction announces only that it happened, plus the id |
| `typing` | `ticket:`, minus the sender | see §7 |

### AI streaming

| Event | Room | Notes |
| :--- | :--- | :--- |
| `ai:stream:chunk` | requesting socket | one token |
| `ai:stream:done` | requesting socket | final text, citations, message id, `status` |
| `ai:stream:error` | requesting socket | |
| `ai:stream:attachments-skipped` | requesting socket | file **names** of attachments not sent to the model. Fires **before** the answer, so show it while the user is still reading |

`ai:stream:done` and `message:new` both arrive for one answer, and that is not
duplication — *"your stream finished, here is the id"* versus *"a message
appeared in this thread"*. Reconcile on the message id.

`status` on `ai:stream:done` may be a value this build does not recognise, in
which case it is the literal `UNSPECIFIED`. Write a default arm.

### Notifications

| Event | Room | Notes |
| :--- | :--- | :--- |
| `notification:new` | `user:` | the whole row — render and deep-link without a fetch |
| `notification:updated` | `user:` | an existing notification **coalesced** — same group, higher count. Update the toast you are already showing rather than stacking a twelfth |
| `notification:read` | `user:` | read or archived **on another device** |
| `notification:unread-count` | `user:` | the authoritative total, pushed on every change |

**Do not increment a local unread counter.** It is always wrong eventually,
because a notification can be read on another device. Take
`notification:unread-count` as the truth and stop polling
`GET /notifications/unread-count`.

### Documents and presence

| Event | Room | Notes |
| :--- | :--- | :--- |
| `document:indexed` | uploader, plus `dept:` or `org:` | |
| `document:failed` | uploader **only** — a failure is not department news | |
| `presence` | `org:` | a colleague's availability changed |

---

## 7. Typing — the client expires it

`typing` frames carry a TTL of **5 seconds** and **you** must expire them.
`typing:stop` is a hint that a closed tab, a dead battery and a lost network all
skip; a client that waits for one shows *"Alice is typing…"* forever.

Emit `typing:start` as often as you like — the server relays at most one frame
per socket per ticket every 2 seconds and drops the rest silently. A dropped
typing frame is invisible and correct.

---

## 8. Reconnection

Socket.IO reconnects on its own. Your responsibilities on each reconnect:

1. **Wait for `connection:ready` again** before emitting.
2. **Re-join every ticket room.** Room membership does not survive a
   reconnection — the server has a new socket and no memory of what the old one
   was watching.
3. **Refetch what you missed.** The socket is a *delivery optimisation, not a
   channel of record*: every event here has a REST equivalent, and rows are
   always written before the frame is emitted. After a gap, re-read the feed and
   the thread rather than assuming continuity.
4. **Re-authenticate first if the cookie expired.** A refused handshake is a
   hard disconnect; reconnect attempts against an expired cookie will keep
   failing until you refresh the session over REST.

---

## 9. Things that will bite

- **Emitting before `connection:ready`** (§3). The most common integration bug,
  and it looks like a flaky server.
- **Missing cookie on React Native** (§2). Works on web, refused on device.
- **Treating the socket as the source of truth.** It is not; the database is.
  Anything you must not lose has a REST read.
- **Assuming rooms survive reconnects** (§8).
- **Stacking notification toasts** instead of handling `notification:updated`
  (§6). Grouping exists server-side and is invisible if you ignore it.
- **Ignoring the `message:send` ack** (§5). A refusal you never read is a message
  the user believes was sent.
- **Waiting for `typing:stop`** (§7).

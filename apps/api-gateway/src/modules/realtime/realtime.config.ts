/**
 * Room names and outbound event names — the two strings a client and the server
 * must agree on exactly, declared once.
 *
 * Template-literal types rather than bare `string`: a room built as
 * `user${id}` (missing colon) or `tickets:${id}` (plural) is a compile error
 * here, where the alternative is a broadcast that reaches nobody and reports
 * nothing. There is no runtime error for emitting into a room that does not
 * exist — Socket.IO simply delivers to the zero sockets in it.
 */
export type UserRoom = `user:${string}`;
export type OrgRoom = `org:${string}`;
export type TicketRoom = `ticket:${string}`;
export type TicketInternalRoom = `ticket:${string}:internal`;
export type DeptRoom = `dept:${string}`;
export type RealtimeRoom =
  UserRoom | OrgRoom | TicketRoom | TicketInternalRoom | DeptRoom;

export const userRoom = (userId: string): UserRoom => `user:${userId}`;
export const orgRoom = (organizationId: string): OrgRoom =>
  `org:${organizationId}`;
export const ticketRoom = (ticketId: string): TicketRoom =>
  `ticket:${ticketId}`;

/**
 * The AGENT-ONLY half of a ticket room — 22-doc §1.
 *
 * **Why a second room rather than a per-socket filter.** `message:new` used to
 * fan every message to `ticket:{id}`, and `TicketAccessService.canRead` admits
 * the ticket's AUTHOR — so the requester sat in that room and received every
 * internal note in real time. The REST read strips internal notes in its
 * `WHERE` clause, so `GET /tickets/:id/messages` was safe and the push was not:
 * a customer with the page open saw the agent-only note appear, and the same
 * customer on refresh did not. **The safe path was the one nobody tested.**
 *
 * Filtering per socket at emit time would work and would need a permission read
 * per socket per message. This puts the authorization decision where it already
 * happens — once, at join — and keeps the fan-out a single room emit with no
 * per-message logic.
 *
 * Joined only by sockets holding `ticket.read.all` at join time. That makes
 * revocation land on the next join rather than immediately, which §6.3 states
 * as the boundary rather than leaving it implied.
 */
export const ticketInternalRoom = (ticketId: string): TicketInternalRoom =>
  `ticket:${ticketId}:internal`;

/**
 * A department's room — 22-doc §6.2.
 *
 * Exists for `document:indexed`. A department-scoped document is invisible to
 * users outside its departments, so announcing it on `org:{id}` would disclose
 * its existence and title to exactly the people the department boundary
 * excludes. Sockets join these at connection from the `departmentIds` already in
 * the verified JWT — no authorization call, for the same reason `user:` and
 * `org:` need none: the ids come from a token the client cannot forge.
 */
export const deptRoom = (departmentId: string): DeptRoom =>
  `dept:${departmentId}`;

/**
 * Events the SERVER emits to clients.
 *
 * Named from the client's point of view (`ticket:updated`, not
 * `ticket.status_changed`) and deliberately COARSER than the NATS patterns
 * behind them: a UI re-renders a ticket the same way whether it was assigned,
 * reassigned or had its status changed, and three events it handles identically
 * is three subscriptions to keep in step.
 *
 * The full domain event travels in the payload, so a client that does want the
 * distinction reads `payload.pattern` — the same discriminant every other
 * consumer switches on.
 */
export const REALTIME_EVENTS = {
  /** Any change to a ticket's own fields. Room: `ticket:{id}` and `org:{id}`. */
  ticketUpdated: 'ticket:updated',
  /** A ticket was created. Room: `org:{id}`. */
  ticketCreated: 'ticket:created',
  /** This ticket is now YOURS. Room: `user:{assigneeId}` — personal, not the
   * ticket room, because it is a call to action rather than a state change. */
  ticketAssigned: 'ticket:assigned',
  /** A new message in the thread. Room: `ticket:{id}`. */
  messageNew: 'message:new',
  /** Emitted to the joining socket alone, confirming a `ticket:join`. */
  ticketJoined: 'ticket:joined',

  /** An edit. Room: `ticket:{id}` or its `:internal` half — 22-doc §6.1. */
  messageUpdated: 'message:updated',
  /**
   * A REDACTION, carrying no content — 22-doc §6.1.
   *
   * The row survives with `content` replaced; this announces *that* it happened
   * plus the message id. Sending the old content in a "deleted" event is the
   * most direct way to defeat a redaction.
   */
  messageDeleted: 'message:deleted',

  /**
   * Someone is replying in this thread. Room: `ticket:{id}`, minus the sender.
   *
   * Carries a TTL and the CLIENT expires it — `typing:stop` is a hint that a
   * closed tab, a dead battery or a lost network all skip, and server-side
   * timers per socket per ticket are state a stateless gateway does not want
   * and would multiply by instance count (22-doc §3).
   */
  typing: 'typing',

  /** A user's availability changed. Room: `org:{id}` — 22-doc §4. */
  presence: 'presence',

  /** One token of a streaming AI answer. Emitted to the REQUESTING SOCKET. */
  aiStreamChunk: 'ai:stream:chunk',
  /**
   * The stream finished: final text, citations and the message id.
   *
   * Emitted alongside `message:new`, and that is not duplication — they answer
   * different questions. "Your stream finished, here is the message id" versus
   * "a message appeared in this thread". A client receiving both reconciles on
   * the id, which is why this carries it (22-doc §5.1).
   */
  aiStreamDone: 'ai:stream:done',
  /** The stream failed. Never used for the budget cap — see 22-doc §5.2. */
  aiStreamError: 'ai:stream:error',
  /**
   * Files that were NOT sent to the model — 36-doc §2.2.
   *
   * Its own event rather than a field on `aiStreamDone`, because it fires
   * BEFORE the answer: a user watching an answer stream in about a screenshot
   * they attached should learn it was skipped while they are still reading,
   * not in the frame that closes the stream.
   *
   * Carries file NAMES only. The contents are the thing that could not be sent.
   */
  aiStreamAttachmentsSkipped: 'ai:stream:attachments-skipped',

  /** A document finished indexing. Rooms: uploader, plus `dept:` or `org:`. */
  documentIndexed: 'document:indexed',
  /** Indexing failed. Room: the UPLOADER only — a failure is not department news. */
  documentFailed: 'document:failed',

  /**
   * Emitted to a socket once the SERVER has finished authenticating it and
   * joining its identity rooms.
   *
   * Not cosmetic. Socket.IO fires `connect` on the client as soon as the
   * transport is up, which is BEFORE `handleConnection` has verified the token
   * and populated `client.data.user` — so a client that emits `ticket:join`
   * immediately on `connect` races the server and is told it is unauthorized,
   * intermittently and unreproducibly. This frame is the "you may start
   * talking" signal, and clients must wait for it.
   */
  connectionReady: 'connection:ready',

  /**
   * A new in-app notification — the toast payload. Room: `user:{recipientId}`.
   *
   * Carries the whole row so the client renders and deep-links without a
   * follow-up fetch.
   */
  notificationNew: 'notification:new',

  /**
   * An existing notification was COALESCED — same group key, higher count.
   *
   * Without this the client stacks a twelfth toast for a thread it is already
   * showing one for, and grouping exists in the database while being invisible
   * in the UI — which is the same shape of failure as a subject with no
   * subscriber.
   */
  notificationUpdated: 'notification:updated',

  /**
   * Read or archived ON ANOTHER DEVICE.
   *
   * `read_at` is per-row rather than per-connection, so without this two open
   * tabs disagree until one of them refreshes and dismissing on mobile leaves
   * the desktop badge lit.
   */
  notificationRead: 'notification:read',

  /**
   * The authoritative unread total, pushed on every change.
   *
   * Lets a client stop polling `GET /notifications/unread-count` and avoids the
   * drift that comes from incrementing a local counter — which is always wrong
   * eventually, because a notification can be read somewhere else.
   */
  notificationUnreadCount: 'notification:unread-count',
} as const;

/** Events the CLIENT emits to the server. */
export const CLIENT_EVENTS = {
  ticketJoin: 'ticket:join',
  ticketLeave: 'ticket:leave',
  messageSend: 'message:send',
  typingStart: 'typing:start',
  typingStop: 'typing:stop',
  presenceUpdate: 'presence:update',
  aiStreamCancel: 'ai:stream:cancel',
} as const;

/**
 * Any event a client may emit.
 *
 * Derived from the registry rather than written out, so a new entry in
 * `CLIENT_EVENTS` widens every signature that accepts one — and, because
 * `WS_EVENT_LIMITS` is `satisfies Record<ClientEvent, ...>`, forgetting to give
 * that new event a rate limit is a compile error rather than an unmetered
 * handler.
 */
export type ClientEvent = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];

/**
 * What a user's presence can be — 22-doc §4.
 *
 * Deliberately small: every state here must mean something a colleague would
 * act on differently. Custom statuses are a product decision with no backend
 * cost and no demand yet (22-doc §8).
 *
 * **Here rather than in `presence.service.ts`, and not in `dto.config.ts`.**
 * `PresenceUpdateDto` validates against this list, and importing it from the
 * SERVICE made a DTO depend on the thing that consumes it. This file is where
 * every other constant two files in this module share already lives —
 * `TYPING_TTL_MS`, `WS_EVENT_LIMITS`, the room builders. `dto.config.ts` is the
 * wrong home for the opposite reason: it holds bounds on request shapes
 * (lengths, batch caps), and this is a domain vocabulary.
 */
export const PRESENCE_STATES = ['online', 'away', 'busy', 'offline'] as const;

export type PresenceState = (typeof PRESENCE_STATES)[number];

/**
 * How long a `typing` frame is valid for, in ms — 22-doc §3.
 *
 * **The CLIENT expires it.** `typing:stop` is a hint that a closed tab, a dead
 * battery and a lost network all skip, so a server that waited for one would
 * show "Alice is typing…" forever. Server-side timers per socket per ticket are
 * state a stateless gateway does not want and would multiply by instance count.
 */
export const TYPING_TTL_MS = 5_000;

/**
 * The minimum gap between RELAYED typing frames, per socket per ticket.
 *
 * A client emitting per keystroke is normal; relaying per keystroke is a
 * broadcast storm on a busy thread. Distinct from `WS_EVENT_LIMITS` below: that
 * one stops abuse and refuses, this one shapes normal traffic and drops
 * silently — a dropped typing frame is invisible and correct.
 */
export const TYPING_RELAY_INTERVAL_MS = 2_000;

/**
 * Per-event rate limits — 22-doc §6.3.
 *
 * **Every C→S handler goes through one of these.** `WsThrottlerService` guarded
 * only the handshake, which left each handler unmetered — and `message:send`
 * reaches the same RPC as `POST /tickets/:id/messages`, so an unmetered socket
 * is a rate-limit bypass for the endpoint the HTTP tier carefully throttles.
 *
 * The numbers differ by what the frame costs and what dropping one costs:
 *
 *   - `messageSend` matches its HTTP twin. A dropped message must be reported,
 *     never swallowed, or the user's text vanishes.
 *   - `typing` is generous and dropped SILENTLY. A client emitting per keystroke
 *     is normal behaviour; relaying per keystroke is a broadcast storm. The
 *     separate ~1-per-2s relay throttle in §3 is a different limit with a
 *     different job — this one only stops abuse.
 *   - `ticketJoin` costs a gRPC round trip to ticket-service, so it is metered
 *     even though it is not a write.
 */
export const WS_EVENT_LIMITS = {
  [CLIENT_EVENTS.ticketJoin]: { limit: 60, ttlMs: 60_000 },
  [CLIENT_EVENTS.ticketLeave]: { limit: 120, ttlMs: 60_000 },
  [CLIENT_EVENTS.messageSend]: { limit: 30, ttlMs: 60_000 },
  [CLIENT_EVENTS.typingStart]: { limit: 240, ttlMs: 60_000 },
  [CLIENT_EVENTS.typingStop]: { limit: 240, ttlMs: 60_000 },
  [CLIENT_EVENTS.presenceUpdate]: { limit: 120, ttlMs: 60_000 },
  [CLIENT_EVENTS.aiStreamCancel]: { limit: 60, ttlMs: 60_000 },
} as const satisfies Record<ClientEvent, { limit: number; ttlMs: number }>;

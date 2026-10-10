import {
  AnswerStatus,
  CLIENT_EVENTS,
  type ClientEvent,
} from '@synapsedesk/common';

/**
 * What a user's presence can be.
 *
 * Deliberately small: every state here must mean something a colleague would
 * act on differently. Custom statuses are a product decision with no backend
 * cost and no demand yet.
 *
 * **Here rather than in `presence.service.ts`, and not in `dto.config.ts`.**
 * `PresenceUpdateDto` validates against this list, and importing it from the
 * SERVICE made a DTO depend on the thing that consumes it. This file is where
 * every other constant two files in this module share already lives —
 * `TYPING_TTL_MS`, `WS_EVENT_LIMITS`. `dto.config.ts` is the
 * wrong home for the opposite reason: it holds bounds on request shapes
 * (lengths, batch caps), and this is a domain vocabulary.
 */
export const PRESENCE_STATES = ['online', 'away', 'busy', 'offline'] as const;

export type PresenceState = (typeof PRESENCE_STATES)[number];

/**
 * How long a `typing` frame is valid for, in ms.
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
 * Per-event rate limits.
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
 *     separate {@link TYPING_RELAY_INTERVAL_MS} throttle is a different limit
 *     with a different job — this one only stops abuse.
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

/**
 * Frame status for an answer status this build does not recognise.
 *
 * Gateway-side vocabulary, NOT the proto's `MESSAGE_ANSWER_STATUS_UNSPECIFIED`:
 * a socket frame carries a NAME a client switches on, and that client needs a
 * default arm it can spell.
 */
export const UNSPECIFIED_FRAME_STATUS = 'UNSPECIFIED';

/** Every value `ai:stream:done` may carry in `status`. */
export type FrameAnswerStatus = AnswerStatus | typeof UNSPECIFIED_FRAME_STATUS;

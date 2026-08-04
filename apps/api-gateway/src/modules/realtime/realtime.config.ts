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
export type RealtimeRoom = UserRoom | OrgRoom | TicketRoom;

export const userRoom = (userId: string): UserRoom => `user:${userId}`;
export const orgRoom = (organizationId: string): OrgRoom =>
  `org:${organizationId}`;
export const ticketRoom = (ticketId: string): TicketRoom =>
  `ticket:${ticketId}`;

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
} as const;

/** Events the CLIENT emits to the server. */
export const CLIENT_EVENTS = {
  ticketJoin: 'ticket:join',
  ticketLeave: 'ticket:leave',
} as const;

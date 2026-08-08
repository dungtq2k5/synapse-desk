import type { ErrorResponse } from './http-response.interface';

/**
 * The envelope every real-time payload is wrapped in.
 *
 * Deliberately the same shape as `SuccessResponse` minus `statusCode` (a socket
 * frame has no HTTP status) and with `data` non-optional. A client already
 * parses `{ success, message, data }` for every REST call; it should not need a
 * second parser because the transport changed.
 *
 * Failures reuse `ErrorResponse` verbatim — see `AllWsExceptionsFilter`.
 */
export interface WsResponse<T = unknown> {
  success: true;
  message: string;
  warning?: string;
  data: T;
}

/**
 * What an ACK-based handler answers with — 22-doc §2.1.
 *
 * **A refusal must arrive in the ACK, not only as an `exception` frame.** The
 * ack is what lets the client clear its pending state, and a refused
 * `message:send` is exactly when clearing matters most: a handler that throws
 * leaves Socket.IO's ack callback uncalled, so the client's spinner runs
 * forever and its retry logic never fires.
 *
 * The failure arm is `ErrorResponse` verbatim — the same shape the exception
 * filter emits and the same shape every REST error uses, so a client needs one
 * parser rather than three.
 */
export type WsAck<T = unknown> = WsResponse<T> | ErrorResponse;

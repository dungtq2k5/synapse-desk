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

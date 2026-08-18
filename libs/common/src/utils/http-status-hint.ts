/**
 * @file Carrying an HTTP status across the gRPC wire, for the cases where no gRPC
 * code means the right thing.
 *
 * Only `code` and `details` survive a gRPC hop — extra fields on an
 * `RpcException` payload are dropped by the transport, silently. The gateway
 * maps `code -> status` from a fixed table, which is right for almost
 * everything.
 *
 * The exception is **402 Payment Required**, which has no gRPC code:
 * `RESOURCE_EXHAUSTED` already means 429 here (OTP throttling says "slow down",
 * not "buy more"), `PERMISSION_DENIED` would send an admin hunting role grants,
 * and `FAILED_PRECONDITION` claims the request was malformed. It was not.
 *
 * So the status travels in the DETAILS, behind a marker the gateway strips —
 * the same shape as `google.rpc.ErrorInfo`, done with a string because Nest's
 * transport does not surface `ErrorInfo`.
 *
 * **Deliberately narrow.** Reach for a gRPC code first; this is for the handful
 * of cases where the table is genuinely wrong.
 */

const MARKER = /^\[http:(\d{3})]\s*/;

/** Prefixes a message with a status the gateway should use instead of the table. */
export function withHttpStatus(httpStatus: number, message: string): string {
  return `[http:${httpStatus}] ${message}`;
}

/**
 * Splits a possibly-marked message back into `{ httpStatus, message }`.
 *
 * Returns `httpStatus: null` for an unmarked message, which is the overwhelming
 * majority — the caller then falls back to the code table as before.
 */
export function readHttpStatusHint(message: string): {
  httpStatus: number | null;
  message: string;
} {
  const match = MARKER.exec(message);
  if (!match) return { httpStatus: null, message };

  const httpStatus = Number(match[1]);

  // A marker outside the plausible range is treated as ordinary text rather
  // than obeyed: a message that happens to start with "[http:999]" must not be
  // able to choose its own status code.
  if (httpStatus < 100 || httpStatus > 599) {
    return { httpStatus: null, message };
  }

  return { httpStatus, message: message.slice(match[0].length) };
}

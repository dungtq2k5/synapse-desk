/**
 * Carrying an HTTP status across the gRPC wire, for the cases where no gRPC
 * code means the right thing.
 *
 * **Why this exists at all.** Only `code` and `details` survive a gRPC hop —
 * extra fields on an `RpcException` payload are dropped by the transport, so
 * "just add `httpStatus` to the object" does not work and fails silently. The
 * gateway therefore maps `code -> status` from a fixed table, which is correct
 * for almost everything.
 *
 * The exception is **402 Payment Required**. gRPC has no code that means it:
 *
 *   - `RESOURCE_EXHAUSTED` already means 429 in this system, and legitimately —
 *     OTP throttling uses it to say "slow down", which is a different
 *     instruction from "buy more".
 *   - `PERMISSION_DENIED` maps to 403 and would send an admin looking at role
 *     grants for a problem that has nothing to do with roles.
 *   - `FAILED_PRECONDITION` maps to 400, which says the request was malformed.
 *     It was not.
 *
 * So the status travels in the DETAILS, behind a marker the gateway strips.
 * This is the same shape gRPC's own `google.rpc.ErrorInfo` uses — structured
 * information riding in the error payload because the status code alone cannot
 * carry it — done with a string because Nest's transport does not surface
 * `ErrorInfo`.
 *
 * Deliberately narrow: this is for the handful of cases where the table is
 * genuinely wrong, not a general-purpose override. Reach for a gRPC code first.
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

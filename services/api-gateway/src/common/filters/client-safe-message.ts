import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { formatErrorMsg, readHttpStatusHint } from '@synapsedesk/common';

/**
 * gRPC status -> HTTP status.
 *
 * Anything not listed here is a bug (or a genuinely unexpected failure) and is
 * deliberately collapsed to a 500 with a generic message, so internal details
 * from a downstream service never leak to the client.
 */
export const GRPC_TO_HTTP: Partial<Record<number, HttpStatus>> = {
  [GrpcStatus.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.FAILED_PRECONDITION]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.OUT_OF_RANGE]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [GrpcStatus.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [GrpcStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [GrpcStatus.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [GrpcStatus.ABORTED]: HttpStatus.CONFLICT,
  [GrpcStatus.RESOURCE_EXHAUSTED]: HttpStatus.TOO_MANY_REQUESTS,
  [GrpcStatus.CANCELLED]: HttpStatus.REQUEST_TIMEOUT,
  [GrpcStatus.UNIMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [GrpcStatus.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [GrpcStatus.DEADLINE_EXCEEDED]: HttpStatus.GATEWAY_TIMEOUT,
};

/**
 * What a client is told for a transport-class gRPC failure nobody vouched for.
 *
 * These three codes are the ones grpc-js generates ITSELF — a peer that is
 * down, a deadline, a cancelled call — with details naming the peer's address.
 * A service that means its own text for the user marks it with
 * `withHttpStatus`, and that text is forwarded instead.
 */
export const TRANSPORT_MESSAGES: Readonly<Partial<Record<number, string>>> = {
  [GrpcStatus.UNAVAILABLE]:
    'A service this request depends on is unavailable. Try again shortly',
  [GrpcStatus.DEADLINE_EXCEEDED]:
    'A service this request depends on took too long to answer. Try again shortly',
  [GrpcStatus.CANCELLED]:
    'The request was cancelled before a service answered. Try again',
};

type GrpcError = { code: number; details?: string; message?: string };

/** A gRPC `ServiceError`, or anything carrying a known gRPC status code. */
export function isGrpcError(error: unknown): error is GrpcError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as GrpcError).code === 'number' &&
    (error as GrpcError).code in GrpcStatus
  );
}

export type ClientSafeOptions = {
  /**
   * Chooses the message for an UNHANDLED error only — the real text outside
   * production, `'Internal server error'` in it. The transport-class rule
   * ignores it: a transport error gets its fixed message in every environment.
   */
  isProduction: boolean;
  /** Where the withheld details are logged. */
  logger?: Logger;
  /** What failed, for the log line — `GET /api/v1/users/me`, `message:send`. */
  context?: string;
};

/**
 * The status and message a client may see for an error, from any transport.
 *
 * The one place that decides it — the HTTP filter, the socket ack, the
 * `ai:stream:error` frame and the WebSocket exception filter all call it:
 *
 * | Error | Status | Message |
 * | :--- | :--- | :--- |
 * | `HttpException` | its own | its own |
 * | gRPC, marked `[http:NNN]` | the marked one | the marked text |
 * | gRPC `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `CANCELLED`, unmarked | from the table | a fixed message — the details are logged, never sent |
 * | any other mapped gRPC code | from the table | the service's text |
 * | anything else | 500 | `'Internal server error'` in production, the real text elsewhere |
 *
 * The rule for the transport codes is about **who vouched for the text**: a
 * status grpc-js generated and one a peer returned are indistinguishable on the
 * error object, so only a marked message is trusted to be written for a user.
 *
 * @example clientSafeError(grpcUnavailable, { isProduction: false }) // { statusCode: 503, message: 'A service this request depends on is unavailable. Try again shortly!' }
 */
export function clientSafeError(
  error: unknown,
  { isProduction, logger, context = 'a request' }: ClientSafeOptions,
): { statusCode: HttpStatus; message: string } {
  if (error instanceof HttpException) {
    return { statusCode: error.getStatus(), message: formatErrorMsg(error) };
  }

  if (isGrpcError(error)) {
    const mapped = GRPC_TO_HTTP[error.code];
    if (mapped !== undefined) {
      const text = formatErrorMsg(error.details ?? error.message);
      // A downstream service may override the table for the few cases where
      // no gRPC code means the right thing — 402 being the one that exists —
      // and the same marker is how it vouches for text a user may read. The
      // hint rides in the details because extra fields on an RpcException do
      // not survive the wire; see `withHttpStatus`.
      const hint = readHttpStatusHint(text);
      const fixed = TRANSPORT_MESSAGES[error.code];

      if (hint.httpStatus === null && fixed !== undefined) {
        logger?.warn(
          `${GrpcStatus[error.code]} on ${context}; details withheld from the client: ${text}`,
        );
        return { statusCode: mapped, message: formatErrorMsg(fixed) };
      }

      return {
        statusCode: hint.httpStatus ?? mapped,
        message: hint.message,
      };
    }

    logger?.error(
      `Unmapped gRPC status ${error.code} (${GrpcStatus[error.code]}) ` +
        `on ${context}: ${error.details ?? error.message}`,
    );
  } else {
    logger?.error(
      `Unhandled exception on ${context}`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    // Outside production the real error is far more useful than a
    // placeholder, and there is no untrusted client to leak it to.
    message: isProduction ? 'Internal server error' : formatErrorMsg(error),
  };
}

/**
 * The message alone, for a transport with no HTTP status of its own.
 *
 * @example clientSafeMessage(error, { isProduction, logger: this.logger, context: 'message:send' })
 */
export function clientSafeMessage(
  error: unknown,
  options: ClientSafeOptions,
): string {
  return clientSafeError(error, options).message;
}

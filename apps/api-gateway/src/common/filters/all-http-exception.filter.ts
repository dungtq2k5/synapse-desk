import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { GqlContextType } from '@nestjs/graphql';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { Request, Response } from 'express';
import { formatErrorMsg, readHttpStatusHint } from '@synapsedesk/common';
import type { ErrorResponse } from '../interfaces/http-response.interface';

/**
 * gRPC status -> HTTP status.
 *
 * Anything not listed here is a bug (or a genuinely unexpected failure) and is
 * deliberately collapsed to a 500 with a generic message, so internal details
 * from a downstream service never leak to the client.
 */
const GRPC_TO_HTTP: Partial<Record<number, HttpStatus>> = {
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

type GrpcError = { code: number; details?: string; message?: string };

function isGrpcError(error: unknown): error is GrpcError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as GrpcError).code === 'number' &&
    (error as GrpcError).code in GrpcStatus
  );
}

/**
 * The gateway's single terminal error handler, across every transport it serves.
 *
 * Three kinds of failure arrive here and each needs different treatment:
 *
 *  1. **HttpException** — raised by the gateway itself (validation, guards, the
 *     504 from a gRPC deadline). Already HTTP-shaped; pass the status through.
 *  2. **A gRPC error from a downstream service** — a status code that means
 *     nothing to HTTP. Without the mapping above, every `RpcException` reaches
 *     the client as a blanket 500 and "wrong password" is indistinguishable
 *     from a crash.
 *  3. **Anything else** — a genuine bug. Logged with its stack, and reported as
 *     a bare 500 in production so internals never leak.
 *
 * GraphQL is handled by re-throwing rather than writing a response: Apollo owns
 * the response envelope there, and calling `response.status().json()` on a
 * GraphQL request writes into a socket Apollo is also writing to.
 */
@Catch()
export class AllHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllHttpExceptionFilter.name);

  /**
   * Passed in rather than injected: global filters are constructed with `new`
   * in main.ts, outside the DI container.
   */
  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { statusCode, message } = this.resolve(exception, host);

    if (host.getType<GqlContextType>() === 'graphql') {
      // Apollo formats the error envelope; normalize the message and re-throw.
      if (exception instanceof Error) exception.message = message;
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    response.status(statusCode).json({
      success: false,
      statusCode,
      path: request.url,
      timestamp: new Date().toISOString(),
      error: message,
    } satisfies ErrorResponse);
  }

  private resolve(
    exception: unknown,
    host: ArgumentsHost,
  ): { statusCode: HttpStatus; message: string } {
    if (exception instanceof HttpException) {
      return {
        statusCode: exception.getStatus(),
        message: formatErrorMsg(exception),
      };
    }

    if (isGrpcError(exception)) {
      const mapped = GRPC_TO_HTTP[exception.code];
      if (mapped !== undefined) {
        // A downstream service may override the table for the few cases where
        // no gRPC code means the right thing — 402 Payment Required being the
        // one that exists today. The hint rides in the details because extra
        // fields on an RpcException do not survive the wire; see
        // `withHttpStatus`. Unmarked messages (almost all of them) fall through
        // to the table unchanged.
        const hint = readHttpStatusHint(
          formatErrorMsg(exception.details ?? exception.message),
        );

        return {
          statusCode: hint.httpStatus ?? mapped,
          message: hint.message,
        };
      }

      this.logger.error(
        `Unmapped gRPC status ${exception.code} (${GrpcStatus[exception.code]}) ` +
          `on ${this.describe(host)}: ${exception.details ?? exception.message}`,
      );
    } else {
      this.logger.error(
        `Unhandled exception on ${this.describe(host)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      // Outside production the real error is far more useful than a
      // placeholder, and there is no untrusted client to leak it to.
      message: this.isProduction
        ? 'Internal server error'
        : formatErrorMsg(exception),
    };
  }

  /** Best-effort request label for logs; GraphQL has no method/url. */
  private describe(host: ArgumentsHost): string {
    if (host.getType<GqlContextType>() === 'graphql') {
      return 'a GraphQL operation';
    }

    const request = host.switchToHttp().getRequest<Request>();
    return `${request.method} ${request.url}`;
  }
}
